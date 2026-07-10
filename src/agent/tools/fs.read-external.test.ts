import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReadOnlyExternalPath, validatePathSecurity } from "./fs.js";

describe("validatePathSecurity — read-only external allowlist", () => {
	const home = os.homedir();
	const tmpdir = process.env.TMPDIR ?? "/tmp";

	it("rejects macOS screenshot paths by default (no opt-in)", () => {
		const screenshot =
			"/var/folders/xx/yy/T/TemporaryItems/NSIRD/Screenshot.jpg";
		const r = validatePathSecurity(screenshot, "/Users/youssefsala7");
		expect(r.safe).toBe(false);
	});

	it("allows macOS screenshot paths with allowExternalRead=true", () => {
		const screenshot =
			"/var/folders/xx/yy/T/TemporaryItems/NSIRD/Screenshot.jpg";
		const r = validatePathSecurity(screenshot, "/Users/youssefsala7", {
			allowExternalRead: true,
		});
		expect(r.safe).toBe(true);
	});

	it("allows $TMPDIR paths with allowExternalRead=true", () => {
		const p = `${tmpdir.replace(/\/$/, "")}/something.png`;
		const r = validatePathSecurity(p, "/Users/youssefsala7", {
			allowExternalRead: true,
		});
		expect(r.safe).toBe(true);
	});

	it("allows ~/Library paths with allowExternalRead=true", () => {
		const p = `${home}/Library/Screenshots/screen.png`;
		const r = validatePathSecurity(p, "/Users/youssefsala7", {
			allowExternalRead: true,
		});
		expect(r.safe).toBe(true);
	});

	it("allows ~/.tehuti/tmp paths with allowExternalRead=true", () => {
		const p = `${home}/.tehuti/tmp/foo.txt`;
		const r = validatePathSecurity(p, "/Users/youssefsala7", {
			allowExternalRead: true,
		});
		expect(r.safe).toBe(true);
	});

	it("rejects ~/.ssh/id_rsa with 'sensitive' reason (sensitive beats allowlist)", () => {
		const home = os.homedir();
		const r = validatePathSecurity(
			`${home}/.ssh/id_rsa`,
			"/Users/youssefsala7",
			{ allowExternalRead: true },
		);
		expect(r.safe).toBe(false);
		expect(r.reason).toContain("sensitive");
	});

	it("rejects ~/.aws/credentials with 'sensitive' reason (sensitive beats allowlist)", () => {
		const home = os.homedir();
		const r = validatePathSecurity(
			`${home}/.aws/credentials`,
			"/Users/youssefsala7",
			{ allowExternalRead: true },
		);
		expect(r.safe).toBe(false);
		expect(r.reason).toContain("sensitive");
	});

	it("rejects /var/folders without opt-in (write tools stay strict)", () => {
		const r = validatePathSecurity(
			"/var/folders/xx/yy/T/foo",
			"/Users/youssefsala7",
		);
		expect(r.safe).toBe(false);
	});

	it("rejects /root even with allowExternalRead=true (not in allowlist)", () => {
		const r = validatePathSecurity("/root/.ssh/id_rsa", "/Users/youssefsala7", {
			allowExternalRead: true,
		});
		expect(r.safe).toBe(false);
	});

	it("still allows paths inside cwd normally", () => {
		const r = validatePathSecurity(
			"/Users/youssefsala7/Projects/Tehuti-CLI-Revival/README.md",
			"/Users/youssefsala7",
		);
		expect(r.safe).toBe(true);
	});
});

describe("isReadOnlyExternalPath", () => {
	const home = os.homedir();

	it("matches the actual macOS screenshot path from the bug report", () => {
		const p =
			"/var/folders/r6/7m_4b2dn6ld4cyvrgf_66fbr0000gn/T/TemporaryItems/NSIRD_screencaptureui_zeAdKv/Screenshot 2026-07-10 at 3.55.45 AM.jpg";
		expect(isReadOnlyExternalPath(p)).toBe(true);
	});

	it("matches /private/var/folders (macOS /var is a symlink)", () => {
		expect(isReadOnlyExternalPath("/private/var/folders/abc/foo")).toBe(true);
	});

	it("matches the actual TMPDIR-derived prefix", () => {
		const home = os.homedir();
		const real = process.env.TMPDIR ?? "/tmp";
		// /tmp literal only matches when TMPDIR is /tmp (Linux). On macOS,
		// TMPDIR is /var/folders/... so /tmp is intentionally not in the
		// allowlist (less surface area for /tmp abuse).
		if (real === "/tmp") {
			expect(isReadOnlyExternalPath("/tmp/abc")).toBe(true);
		} else {
			expect(isReadOnlyExternalPath("/tmp/abc")).toBe(false);
		}
		// TMPDIR-derived paths always match
		const tmpPath = `${real.replace(/\/$/, "")}/foo.png`;
		expect(isReadOnlyExternalPath(tmpPath)).toBe(true);
		// The canonical macOS screenshot case
		expect(
			isReadOnlyExternalPath(`${home}/.tehuti/tmp/incoming/anything.jpg`),
		).toBe(true);
	});

	it("does not match a deep /var that isn't folders/", () => {
		expect(isReadOnlyExternalPath("/var/log/messages")).toBe(false);
	});

	it("does not match /Users paths", () => {
		expect(
			isReadOnlyExternalPath(path.join(home, "Documents/secret.txt")),
		).toBe(false);
	});
});
