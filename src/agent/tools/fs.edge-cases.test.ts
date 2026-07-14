import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import {
	resolvePath,
	validatePathSecurity,
	isReadOnlyExternalPath,
	computeHashline,
	findLineByHash,
} from "./fs.js";

describe("fs edge cases", () => {
	describe("resolvePath", () => {
		it("should handle empty file path by returning cwd", () => {
			const cwd = "/home/user/project";
			const result = resolvePath("", cwd);
			expect(result).toBe(cwd);
		});

		it("should handle very long file path", () => {
			const cwd = "/home/user/project";
			const longSegment = "a".repeat(200);
			const longPath = Array(10).fill(longSegment).join("/");
			const result = resolvePath(longPath, cwd);
			expect(result).toBe(path.resolve(cwd, longPath));
			expect(result.length).toBeGreaterThan(1000);
		});

		it("should handle special characters in path", () => {
			const cwd = "/home/user/project";
			const specialPath = "dir/file with spaces (1)/café/日本語/🎉.txt";
			const result = resolvePath(specialPath, cwd);
			expect(result).toBe(path.resolve(cwd, specialPath));
		});

		it("should handle absolute path by ignoring cwd", () => {
			const cwd = "/home/user/project";
			const result = resolvePath("/tmp/other", cwd);
			expect(result).toBe("/tmp/other");
		});

		it("should handle path with consecutive slashes", () => {
			const cwd = "/home/user/project";
			const result = resolvePath("dir//subdir///file.txt", cwd);
			expect(result).toBe(path.resolve(cwd, "dir//subdir///file.txt"));
		});

		it("should handle path with trailing slash", () => {
			const cwd = "/home/user/project";
			const result = resolvePath("dir/", cwd);
			expect(result).toBe(path.resolve(cwd, "dir/"));
		});

		it("should handle path with only dots", () => {
			const cwd = "/home/user/project";
			const result = resolvePath(".", cwd);
			expect(result).toBe(cwd);
		});

		it("should handle path with dot-dot segments", () => {
			const cwd = "/home/user/project";
			const result = resolvePath("../other", cwd);
			expect(result).toBe(path.resolve(cwd, "../other"));
		});

		it("should handle path with null bytes gracefully", () => {
			const cwd = "/home/user/project";
			// null bytes in path — OS may reject, but resolvePath should not throw
			const result = resolvePath("dir/file\0.txt", cwd);
			expect(typeof result).toBe("string");
		});

		it("should handle path with newlines", () => {
			const cwd = "/home/user/project";
			const result = resolvePath("dir/file\nname.txt", cwd);
			expect(result).toBe(path.resolve(cwd, "dir/file\nname.txt"));
		});

		it("should handle path with tab characters", () => {
			const cwd = "/home/user/project";
			const result = resolvePath("dir/file\tname.txt", cwd);
			expect(result).toBe(path.resolve(cwd, "dir/file\tname.txt"));
		});

		it("should handle extremely nested relative path", () => {
			const cwd = "/home/user/project";
			const deepPath = Array(100).fill("..").join("/") + "/target";
			const result = resolvePath(deepPath, cwd);
			expect(result).toBe(path.resolve(cwd, deepPath));
		});
	});

	describe("validatePathSecurity", () => {
		it("should reject path traversal with double dots", () => {
			const result = validatePathSecurity("/home/user/project/../../etc/passwd");
			expect(result.safe).toBe(false);
			expect(result.reason).toBe("Path traversal detected");
		});

		it("should handle path with fully URL-encoded dots (no literal '..')", () => {
			const result = validatePathSecurity("/home/user/%2E%2E/etc/passwd");
			expect(result.safe).toBe(true); // %2E%2E is not literal ".."
		});

		it("should reject sensitive SSH key files", () => {
			const result = validatePathSecurity("/home/user/.ssh/id_rsa");
			expect(result.safe).toBe(false);
			expect(result.reason).toBe("Access to sensitive files is restricted");
		});

		it("should reject .env files", () => {
			const result = validatePathSecurity("/home/user/project/.env");
			expect(result.safe).toBe(false);
			expect(result.reason).toBe("Access to sensitive files is restricted");
		});

		it("should reject .env.local files", () => {
			const result = validatePathSecurity("/home/user/project/.env.local");
			expect(result.safe).toBe(false);
			expect(result.reason).toBe("Access to sensitive files is restricted");
		});

		it("should reject .pem files", () => {
			const result = validatePathSecurity("/home/user/project/cert.pem");
			expect(result.safe).toBe(false);
		});

		it("should reject credentials files", () => {
			const result = validatePathSecurity("/home/user/project/credentials.json");
			expect(result.safe).toBe(false);
		});

		it("should reject secrets files", () => {
			const result = validatePathSecurity("/home/user/project/secrets.yaml");
			expect(result.safe).toBe(false);
		});

		it("should reject .gitconfig", () => {
			const result = validatePathSecurity("/home/user/.gitconfig");
			expect(result.safe).toBe(false);
		});

		it("should allow normal project files", () => {
			const result = validatePathSecurity("/home/user/project/src/index.ts");
			expect(result.safe).toBe(true);
		});

		it("should allow files in normal subdirectories", () => {
			const result = validatePathSecurity("/home/user/project/docs/readme.md");
			expect(result.safe).toBe(true);
		});

		it("should handle empty path", () => {
			const result = validatePathSecurity("");
			expect(result.safe).toBe(true);
		});

		it("should handle path with only spaces", () => {
			const result = validatePathSecurity("   ");
			expect(result.safe).toBe(true);
		});

		it("should handle very long valid path", () => {
			const longPath = "/home/user/project/" + "a".repeat(2000);
			const result = validatePathSecurity(longPath);
			expect(result.safe).toBe(true);
		});

		it("should reject .npmrc", () => {
			const result = validatePathSecurity("/home/user/.npmrc");
			expect(result.safe).toBe(false);
		});

		it("should reject .netrc", () => {
			const result = validatePathSecurity("/home/user/.netrc");
			expect(result.safe).toBe(false);
		});

		it("should reject gnupg directory", () => {
			const result = validatePathSecurity("/home/user/.gnupg/secring.gpg");
			expect(result.safe).toBe(false);
		});
	});

	describe("isReadOnlyExternalPath", () => {
		it("should allow paths within home directory", () => {
			const home = os.homedir();
			expect(isReadOnlyExternalPath(path.join(home, "Documents/file.txt"))).toBe(
				false,
			);
		});

		it("should allow /var/folders on macOS (screenshots etc.)", () => {
			expect(isReadOnlyExternalPath("/var/folders/ab/cdef/Screenshot.png")).toBe(
				true,
			);
		});

		it("should allow tmp directory", () => {
			const tmpdir = process.env.TMPDIR ?? "/tmp";
			const tmpPath = tmpdir.endsWith("/") ? tmpdir : `${tmpdir}/`;
			expect(isReadOnlyExternalPath(`${tmpPath}scratch.txt`)).toBe(true);
		});

		it("should allow Library directory on macOS", () => {
			const home = os.homedir();
			expect(
				isReadOnlyExternalPath(`${home}/Library/Application Support/file.db`),
			).toBe(true);
		});

		it("should not allow project source files", () => {
			expect(isReadOnlyExternalPath("/home/user/project/src/index.ts")).toBe(
				false,
			);
		});
	});

	describe("computeHashline edge cases", () => {
		it("should handle empty string", () => {
			const hash = computeHashline("");
			expect(hash).toHaveLength(12);
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});

		it("should handle very long string (10000+ chars)", () => {
			const longText = "x".repeat(10000);
			const hash = computeHashline(longText);
			expect(hash).toHaveLength(12);
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});

		it("should handle string with special characters", () => {
			const special = "line with spaces\tand\ttabs\nand\nnewlines";
			const hash = computeHashline(special);
			expect(hash).toHaveLength(12);
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});

		it("should handle unicode characters", () => {
			const unicode = "日本語テスト café naïve 🎉";
			const hash = computeHashline(unicode);
			expect(hash).toHaveLength(12);
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});

		it("should handle null bytes", () => {
			const withNull = "before\0after";
			const hash = computeHashline(withNull);
			expect(hash).toHaveLength(12);
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});

		it("should be deterministic", () => {
			const text = "deterministic test";
			const h1 = computeHashline(text);
			const h2 = computeHashline(text);
			expect(h1).toBe(h2);
		});

		it("should produce different hashes for different inputs", () => {
			const h1 = computeHashline("line A");
			const h2 = computeHashline("line B");
			expect(h1).not.toBe(h2);
		});

		it("should handle emoji-only content", () => {
			const emoji = "🔥💀👻🦀";
			const hash = computeHashline(emoji);
			expect(hash).toHaveLength(12);
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});

		it("should handle whitespace-only content", () => {
			const spaces = "   \t  \n  ";
			const hash = computeHashline(spaces);
			expect(hash).toHaveLength(12);
			expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
		});
	});

	describe("findLineByHash edge cases", () => {
		it("should handle empty content", () => {
			const result = findLineByHash("", "aaaaaaaaaaaa");
			expect(result).toBeNull();
		});

		it("should find hash of empty line", () => {
			const content = "line1\n\nline3";
			const hash = computeHashline("");
			const result = findLineByHash(content, hash);
			expect(result).toBe(1);
		});

		it("should handle content with only newlines", () => {
			const content = "\n\n\n";
			const hash = computeHashline("");
			const result = findLineByHash(content, hash);
			expect(result).toBe(0);
		});

		it("should handle very long lines", () => {
			const longLine = "a".repeat(5000);
			const content = `prefix\n${longLine}\nsuffix`;
			const hash = computeHashline(longLine);
			const result = findLineByHash(content, hash);
			expect(result).toBe(1);
		});

		it("should handle hash with wrong length", () => {
			const result = findLineByHash("line1", "abc");
			expect(result).toBeNull();
		});

		it("should handle unicode content", () => {
			const content = "日本語\ncafé\n🎉";
			const hash = computeHashline("café");
			const result = findLineByHash(content, hash);
			expect(result).toBe(1);
		});

		it("should handle content with consecutive identical lines", () => {
			const content = "dup\ndup\ndup";
			const hash = computeHashline("dup");
			const result = findLineByHash(content, hash);
			expect(result).toBe(0); // returns first match
		});

		it("should return null for non-existent hash", () => {
			const result = findLineByHash("line1\nline2", "zzzzzzzzzzzz");
			expect(result).toBeNull();
		});

		it("should handle single line content", () => {
			const content = "only line";
			const hash = computeHashline("only line");
			const result = findLineByHash(content, hash);
			expect(result).toBe(0);
		});

		it("should handle content with trailing newline", () => {
			const content = "line1\nline2\n";
			const hash = computeHashline("line2");
			const result = findLineByHash(content, hash);
			expect(result).toBe(1);
		});
	});
});
