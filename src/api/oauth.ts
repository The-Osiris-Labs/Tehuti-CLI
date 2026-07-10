import { exec } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { loadConfig, saveGlobalConfig } from "../config/loader.js";

// Users should set these environment variables if they want to use their own GCP project.
// The default placeholders will require the user to configure them.
const GOOGLE_CLIENT_ID =
	process.env.GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID";
const GOOGLE_CLIENT_SECRET =
	process.env.GOOGLE_CLIENT_SECRET || "YOUR_GOOGLE_CLIENT_SECRET";
const PORTS_TO_TRY = [3030, 3031, 3032, 3033, 0];

const SCOPES = [
	"https://www.googleapis.com/auth/generative-language.retriever",
	"https://www.googleapis.com/auth/cloud-platform",
];

export async function authenticateGoogleOAuth(): Promise<void> {
	if (GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID") {
		throw new Error(
			"Google OAuth is not fully configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
		);
	}

	return new Promise((resolve, reject) => {
		const state = crypto.randomBytes(16).toString("hex");
		const codeVerifier = crypto.randomBytes(32).toString("base64url");
		const codeChallenge = crypto
			.createHash("sha256")
			.update(codeVerifier)
			.digest("base64url");

		let timeoutId: NodeJS.Timeout;
		let currentPortIndex = 0;
		const server = http.createServer(async (req, res) => {
			try {
				if (!req.url?.startsWith("/oauth2callback")) {
					res.writeHead(404);
					res.end("Not found");
					return;
				}

				const address = server.address();
				const actualPort = typeof address === "string" ? null : address?.port;
				const redirectUri = `http://127.0.0.1:${actualPort}/oauth2callback`;
				const url = new URL(req.url, `http://localhost:${actualPort}`);

				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");
				const returnedState = url.searchParams.get("state");

				clearTimeout(timeoutId);

				if (error) {
					res.writeHead(400);
					res.end(`Authentication failed: ${error}`);
					server.close();
					return reject(new Error(`OAuth Error: ${error}`));
				}

				if (!code) {
					res.writeHead(400);
					res.end("No authorization code found");
					server.close();
					return reject(new Error("No authorization code found"));
				}

				if (returnedState !== state) {
					res.writeHead(400);
					res.end("Invalid state parameter (CSRF protection)");
					server.close();
					return reject(
						new Error("Invalid state parameter. Possible CSRF attack."),
					);
				}

				// Exchange code for tokens
				const tokenResponse = await fetch(
					"https://oauth2.googleapis.com/token",
					{
						method: "POST",
						headers: {
							"Content-Type": "application/x-www-form-urlencoded",
						},
						body: new URLSearchParams({
							code,
							client_id: GOOGLE_CLIENT_ID,
							client_secret: GOOGLE_CLIENT_SECRET,
							redirect_uri: redirectUri,
							grant_type: "authorization_code",
							code_verifier: codeVerifier,
						}),
					},
				);

				const tokenData = (await tokenResponse.json()) as Record<string, any>;

				if (!tokenResponse.ok) {
					throw new Error(
						tokenData.error_description ||
							tokenData.error ||
							"Token exchange failed",
					);
				}

				const config = await loadConfig();
				const oauthConfig = config.oauth || {};
				oauthConfig.google = {
					accessToken: tokenData.access_token,
					refreshToken:
						tokenData.refresh_token || oauthConfig.google?.refreshToken,
					expiry: Date.now() + tokenData.expires_in * 1000,
				};

				saveGlobalConfig({ oauth: oauthConfig });

				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(
					"<h1>Authentication successful!</h1><p>You can close this window and return to Tehuti CLI.</p>",
				);
				server.close();
				resolve();
			} catch (err) {
				res.writeHead(500);
				res.end(
					`Internal Server Error: ${err instanceof Error ? err.message : String(err)}`,
				);
				server.close();
				reject(err);
			}
		});

		timeoutId = setTimeout(() => {
			server.close();
			reject(new Error("Authentication timed out after 3 minutes."));
		}, 180000);

		server.on("error", (e: any) => {
			if (e.code === "EADDRINUSE") {
				currentPortIndex++;
				if (currentPortIndex < PORTS_TO_TRY.length) {
					server.listen(PORTS_TO_TRY[currentPortIndex]);
				} else {
					clearTimeout(timeoutId);
					reject(
						new Error(
							"Could not find an available port for the OAuth callback server.",
						),
					);
				}
			} else {
				clearTimeout(timeoutId);
				reject(e);
			}
		});

		server.listen(PORTS_TO_TRY[0], () => {
			const address = server.address();
			const actualPort = typeof address === "string" ? null : address?.port;
			const redirectUri = `http://127.0.0.1:${actualPort}/oauth2callback`;

			const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
			authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
			authUrl.searchParams.set("redirect_uri", redirectUri);
			authUrl.searchParams.set("response_type", "code");
			authUrl.searchParams.set("scope", SCOPES.join(" "));
			authUrl.searchParams.set("access_type", "offline");
			authUrl.searchParams.set("prompt", "consent");
			authUrl.searchParams.set("state", state);
			authUrl.searchParams.set("code_challenge", codeChallenge);
			authUrl.searchParams.set("code_challenge_method", "S256");

			const urlStr = authUrl.toString();
			let command = "";
			if (process.platform === "darwin") {
				command = `open "${urlStr}"`;
			} else if (process.platform === "win32") {
				command = `start "" "${urlStr}"`;
			} else {
				command = `xdg-open "${urlStr}"`;
			}

			exec(command, (err) => {
				if (err) {
					console.error(
						"Failed to open browser. Please navigate to this URL manually:\\n",
						urlStr,
					);
				}
			});
		});
	});
}

export async function getValidGoogleAccessToken(): Promise<string | null> {
	const config = await loadConfig();
	const googleAuth = config.oauth?.google;

	if (!googleAuth?.refreshToken) {
		return null;
	}

	// Add 1 minute buffer for expiry
	if (
		googleAuth.accessToken &&
		googleAuth.expiry &&
		Date.now() + 60000 < googleAuth.expiry
	) {
		return googleAuth.accessToken;
	}

	// Refresh token
	if (GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID") {
		return null; // Can't refresh without credentials
	}

	try {
		const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: GOOGLE_CLIENT_ID,
				client_secret: GOOGLE_CLIENT_SECRET,
				refresh_token: googleAuth.refreshToken,
				grant_type: "refresh_token",
			}),
		});

		const tokenData = (await tokenResponse.json()) as Record<string, any>;

		if (!tokenResponse.ok) {
			// If refresh token is revoked/expired, clear it
			const oauthConfig = config.oauth || {};
			if (oauthConfig.google) {
				delete oauthConfig.google;
				saveGlobalConfig({ oauth: oauthConfig });
			}
			throw new Error(
				tokenData.error_description ||
					tokenData.error ||
					"Token refresh failed",
			);
		}

		const oauthConfig = config.oauth || {};
		oauthConfig.google = {
			...oauthConfig.google,
			accessToken: tokenData.access_token,
			expiry: Date.now() + tokenData.expires_in * 1000,
		};

		saveGlobalConfig({ oauth: oauthConfig });
		return tokenData.access_token;
	} catch (err) {
		console.error("Failed to refresh Google access token:", err);
		return null;
	}
}
