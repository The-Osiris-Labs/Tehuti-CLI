/**
 * OAuth token encryption at rest using AES-256-GCM.
 *
 * Encryption key is derived from stable machine identifiers (hostname + username)
 * so tokens are protected against config file theft/backup/sync while remaining
 * usable on the same machine without user interaction.
 *
 * Encrypted format: "enc1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * The "enc1:" prefix enables versioning and plaintext detection.
 */

import crypto from "node:crypto";
import os from "node:os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128-bit IV
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const ENCRYPTED_PREFIX = "enc1:";
const KEY_DERIVATION_ITERATIONS = 100_000;

/**
 * Derive a stable 256-bit encryption key from machine identifiers.
 * Uses PBKDF2 with a static salt derived from hostname+username.
 */
function deriveEncryptionKey(): Buffer {
	const hostname = os.hostname() || "unknown-host";
	const username = os.userInfo().username || "unknown-user";
	const machineId = `${hostname}:${username}`;

	// Use a deterministic salt derived from machine identity
	const salt = crypto.createHash("sha256").update(`tehuti-salt:${machineId}`).digest();

	const key = crypto.pbkdf2Sync(
		machineId,
		salt,
		KEY_DERIVATION_ITERATIONS,
		32, // 256 bits for AES-256
		"sha256",
	);

	return key;
}

// Cache the derived key to avoid re-deriving on every call
let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
	if (!cachedKey) {
		cachedKey = deriveEncryptionKey();
	}
	return cachedKey;
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 * @returns Encrypted string in format "enc1:<iv>:<authTag>:<ciphertext>" (hex encoded)
 */
export function encryptToken(plaintext: string): string {
	if (!plaintext) {
		return plaintext;
	}

	// Already encrypted - don't double-encrypt
	if (isEncrypted(plaintext)) {
		return plaintext;
	}

	const key = getEncryptionKey();
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	let encrypted = cipher.update(plaintext, "utf8", "hex");
	encrypted += cipher.final("hex");
	const authTag = cipher.getAuthTag();

	return `${ENCRYPTED_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt an encrypted token.
 * @param encryptedToken Token in format "enc1:<iv>:<authTag>:<ciphertext>"
 * @returns Decrypted plaintext token
 * @throws Error if decryption fails (tampered data or wrong key)
 */
export function decryptToken(encryptedToken: string): string {
	if (!encryptedToken) {
		return encryptedToken;
	}

	// Not encrypted - return as-is (handles plaintext migration gracefully)
	if (!isEncrypted(encryptedToken)) {
		return encryptedToken;
	}

	const key = getEncryptionKey();
	const payload = encryptedToken.slice(ENCRYPTED_PREFIX.length);
	const parts = payload.split(":");

	if (parts.length !== 3) {
		throw new Error("Invalid encrypted token format");
	}

	const [ivHex, authTagHex, ciphertext] = parts;

	try {
		const iv = Buffer.from(ivHex, "hex");
		const authTag = Buffer.from(authTagHex, "hex");

		if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
			throw new Error("Invalid IV or auth tag length");
		}

		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(authTag);

		let decrypted = decipher.update(ciphertext, "hex", "utf8");
		decrypted += decipher.final("utf8");

		return decrypted;
	} catch (err) {
		// Don't log the token value - security risk
		throw new Error(
			"Failed to decrypt OAuth token. The config file may have been tampered with or moved from another machine.",
		);
	}
}

/**
 * Check if a token string is encrypted (has the enc1: prefix).
 */
export function isEncrypted(value: string): boolean {
	return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt all sensitive fields in an oauth config object.
 * Handles nested provider objects (e.g., oauth.google.accessToken).
 */
export function encryptOAuthConfig(
	oauthConfig: Record<string, any>,
): Record<string, any> {
	if (!oauthConfig || typeof oauthConfig !== "object") {
		return oauthConfig;
	}

	const encrypted = { ...oauthConfig };

	for (const [provider, providerConfig] of Object.entries(encrypted)) {
		if (
			providerConfig &&
			typeof providerConfig === "object" &&
			!Array.isArray(providerConfig)
		) {
			const pc = { ...providerConfig };

			if (typeof pc.accessToken === "string" && pc.accessToken) {
				pc.accessToken = encryptToken(pc.accessToken);
			}
			if (typeof pc.refreshToken === "string" && pc.refreshToken) {
				pc.refreshToken = encryptToken(pc.refreshToken);
			}

			encrypted[provider] = pc;
		}
	}

	return encrypted;
}

/**
 * Decrypt all sensitive fields in an oauth config object.
 * Handles migration: plaintext tokens are returned as-is.
 * Returns both decrypted config and whether migration occurred.
 */
export function decryptOAuthConfig(oauthConfig: Record<string, any>): {
	config: Record<string, any>;
	migrated: boolean;
} {
	if (!oauthConfig || typeof oauthConfig !== "object") {
		return { config: oauthConfig, migrated: false };
	}

	const decrypted = { ...oauthConfig };
	let migrated = false;

	for (const [provider, providerConfig] of Object.entries(decrypted)) {
		if (
			providerConfig &&
			typeof providerConfig === "object" &&
			!Array.isArray(providerConfig)
		) {
			const pc = { ...providerConfig };
			let providerMigrated = false;

			if (typeof pc.accessToken === "string" && pc.accessToken) {
				if (!isEncrypted(pc.accessToken)) {
					providerMigrated = true;
				}
				pc.accessToken = decryptToken(pc.accessToken);
			}
			if (typeof pc.refreshToken === "string" && pc.refreshToken) {
				if (!isEncrypted(pc.refreshToken)) {
					providerMigrated = true;
				}
				pc.refreshToken = decryptToken(pc.refreshToken);
			}

			decrypted[provider] = pc;
			if (providerMigrated) {
				migrated = true;
			}
		}
	}

	return { config: decrypted, migrated };
}
