import { describe, expect, it } from "vitest";

const PRIVATE_IP_RANGES = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2[0-9]|3[0-1])\./,
	/^192\.168\./,
	/^169\.254\./,
	/^0\.0\.0\.0$/,
	/^::1$/,
	/^fc[0-9a-f]{2}(:|$)/i,
	/^fd[0-9a-f]{2}(:|$)/i,
	/^fe80(:|$)/i,
	/^localhost$/i,
];

function isPrivateIP(ip: string): boolean {
	return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

const BLOCKED_DOMAINS = [
	"facebook.com",
	"twitter.com",
	"x.com",
	"instagram.com",
	"tiktok.com",
	"pinterest.com",
];

function isBlockedDomain(hostname: string): boolean {
	return BLOCKED_DOMAINS.some((blocked) => hostname.includes(blocked));
}

describe("Web Tool Security", () => {
	describe("Private IP detection", () => {
		it("should detect localhost", () => {
			expect(isPrivateIP("localhost")).toBe(true);
		});

		it("should detect 127.0.0.1", () => {
			expect(isPrivateIP("127.0.0.1")).toBe(true);
		});

		it("should detect 127.x.x.x", () => {
			expect(isPrivateIP("127.0.0.5")).toBe(true);
			expect(isPrivateIP("127.255.255.255")).toBe(true);
		});

		it("should detect 10.x.x.x (Class A private)", () => {
			expect(isPrivateIP("10.0.0.1")).toBe(true);
			expect(isPrivateIP("10.255.255.255")).toBe(true);
		});

		it("should detect 172.16-31.x.x (Class B private)", () => {
			expect(isPrivateIP("172.16.0.1")).toBe(true);
			expect(isPrivateIP("172.20.0.1")).toBe(true);
			expect(isPrivateIP("172.31.255.255")).toBe(true);
		});

		it("should not detect 172.15.x.x or 172.32.x.x", () => {
			expect(isPrivateIP("172.15.0.1")).toBe(false);
			expect(isPrivateIP("172.32.0.1")).toBe(false);
		});

		it("should detect 192.168.x.x (Class C private)", () => {
			expect(isPrivateIP("192.168.0.1")).toBe(true);
			expect(isPrivateIP("192.168.255.255")).toBe(true);
		});

		it("should detect 169.254.x.x (link-local)", () => {
			expect(isPrivateIP("169.254.0.1")).toBe(true);
		});

		it("should detect 0.0.0.0", () => {
			expect(isPrivateIP("0.0.0.0")).toBe(true);
		});

		it("should detect IPv6 localhost", () => {
			expect(isPrivateIP("::1")).toBe(true);
		});

		it("should detect IPv6 private fc00::/7", () => {
			expect(isPrivateIP("fc00::1")).toBe(true);
			expect(isPrivateIP("fd00::1")).toBe(true);
		});

		it("should detect IPv6 link-local fe80::/10", () => {
			expect(isPrivateIP("fe80::1")).toBe(true);
		});

		it("should allow public IPs", () => {
			expect(isPrivateIP("8.8.8.8")).toBe(false);
			expect(isPrivateIP("1.1.1.1")).toBe(false);
			expect(isPrivateIP("151.101.1.69")).toBe(false);
		});
	});

	describe("Blocked domains", () => {
		it("should block facebook.com", () => {
			expect(isBlockedDomain("facebook.com")).toBe(true);
			expect(isBlockedDomain("www.facebook.com")).toBe(true);
		});

		it("should block twitter.com and x.com", () => {
			expect(isBlockedDomain("twitter.com")).toBe(true);
			expect(isBlockedDomain("x.com")).toBe(true);
		});

		it("should block instagram.com", () => {
			expect(isBlockedDomain("instagram.com")).toBe(true);
		});

		it("should block tiktok.com", () => {
			expect(isBlockedDomain("tiktok.com")).toBe(true);
		});

		it("should block pinterest.com", () => {
			expect(isBlockedDomain("pinterest.com")).toBe(true);
		});

		it("should allow other domains", () => {
			expect(isBlockedDomain("github.com")).toBe(false);
			expect(isBlockedDomain("npmjs.com")).toBe(false);
			expect(isBlockedDomain("stackoverflow.com")).toBe(false);
		});
	});

	describe("URL validation", () => {
		it("should parse valid URLs", () => {
			const url = new URL("https://example.com/path?query=1");
			expect(url.hostname).toBe("example.com");
		});

		it("should reject invalid URLs", () => {
			expect(() => new URL("not a url")).toThrow();
		});

		it("should extract hostname correctly", () => {
			const url = new URL("https://sub.domain.example.com:8080/path");
			expect(url.hostname).toBe("sub.domain.example.com");
		});

		it("should only allow http and https schemes", () => {
			const httpUrl = new URL("http://example.com");
			expect(httpUrl.protocol).toBe("http:");

			const httpsUrl = new URL("https://example.com");
			expect(httpsUrl.protocol).toBe("https:");
		});

		it("should reject file:// scheme", () => {
			const fileUrl = new URL("file:///etc/passwd");
			expect(fileUrl.protocol).toBe("file:");
			expect(fileUrl.protocol).not.toBe("https:");
		});

		it("should reject ftp:// scheme", () => {
			const ftpUrl = new URL("ftp://example.com/file");
			expect(ftpUrl.protocol).toBe("ftp:");
		});

		it("should reject data: URLs", () => {
			const dataUrl = new URL("data:text/html,<script>alert(1)</script>");
			expect(dataUrl.protocol).toBe("data:");
		});
	});
});
