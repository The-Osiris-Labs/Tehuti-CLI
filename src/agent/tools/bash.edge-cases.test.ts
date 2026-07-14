import { describe, it, expect } from "vitest";
import { isDangerousCommand } from "./bash.js";

describe("bash edge cases", () => {
	describe("empty and whitespace commands", () => {
		it("should handle empty string", () => {
			const result = isDangerousCommand("");
			expect(result.dangerous).toBe(false);
		});

		it("should handle whitespace-only command", () => {
			const result = isDangerousCommand("   ");
			expect(result.dangerous).toBe(false);
		});

		it("should handle tab-only command", () => {
			const result = isDangerousCommand("\t");
			expect(result.dangerous).toBe(false);
		});

		it("should handle newline-only command", () => {
			const result = isDangerousCommand("\n");
			expect(result.dangerous).toBe(false);
		});

		it("should handle mixed whitespace command", () => {
			const result = isDangerousCommand(" \t\n  ");
			expect(result.dangerous).toBe(false);
		});
	});

	describe("very long commands", () => {
		it("should handle 10000+ character command", () => {
			const longArg = "a".repeat(10000);
			const result = isDangerousCommand(`echo "${longArg}"`);
			expect(result.dangerous).toBe(false);
		});

		it("should handle very long command with dangerous pattern at end", () => {
			const padding = "echo hello; ".repeat(1000);
			const result = isDangerousCommand(`${padding}rm -rf /`);
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("Recursive delete");
		});

		it("should handle very long command with dangerous pattern at start", () => {
			const result = isDangerousCommand(`rm -rf / ${"x".repeat(10000)}`);
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("Recursive delete");
		});

		it("should handle extremely long safe command", () => {
			const longArg = "x".repeat(50000);
			const result = isDangerousCommand(`echo "${longArg}"`);
			expect(result.dangerous).toBe(false);
		});
	});

	describe("special characters in commands", () => {
		it("should handle command with pipes", () => {
			const result = isDangerousCommand("ls | grep test | wc -l");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with redirects", () => {
			const result = isDangerousCommand("echo hello > /tmp/output.txt");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with append redirect", () => {
			const result = isDangerousCommand("echo line >> /tmp/log.txt");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with semicolons", () => {
			const result = isDangerousCommand("echo a; echo b; echo c");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with ampersand (background)", () => {
			const result = isDangerousCommand("sleep 10 &");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with curly braces", () => {
			const result = isDangerousCommand("echo {1..10}");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with square brackets", () => {
			const result = isDangerousCommand("echo $PATH");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with single quotes", () => {
			const result = isDangerousCommand("echo 'hello world'");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with double quotes", () => {
			const result = isDangerousCommand('echo "hello world"');
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with backticks (subshell)", () => {
			const result = isDangerousCommand("echo `date`");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("Backtick");
		});

		it("should handle command with dollar-paren (subshell)", () => {
			const result = isDangerousCommand("echo $(date)");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("Command substitution");
		});

		it("should handle command with exclamation mark", () => {
			const result = isDangerousCommand("echo !hello");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with hash (comment)", () => {
			const result = isDangerousCommand("echo test # this is a comment");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with tilde", () => {
			const result = isDangerousCommand("ls ~/Documents");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with equals sign", () => {
			const result = isDangerousCommand("FOO=bar echo $FOO");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with colon", () => {
			const result = isDangerousCommand(":");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with percent", () => {
			const result = isDangerousCommand("echo 50%");
			expect(result.dangerous).toBe(false);
		});
	});

	describe("unicode and multibyte characters", () => {
		it("should handle unicode command arguments", () => {
			const result = isDangerousCommand("echo 日本語テスト");
			expect(result.dangerous).toBe(false);
		});

		it("should handle emoji in command", () => {
			const result = isDangerousCommand("echo 🎉🔥👻");
			expect(result.dangerous).toBe(false);
		});

		it("should handle accented characters", () => {
			const result = isDangerousCommand("echo café naïve résumé");
			expect(result.dangerous).toBe(false);
		});

		it("should handle Cyrillic characters", () => {
			const result = isDangerousCommand("echo привет мир");
			expect(result.dangerous).toBe(false);
		});

		it("should handle Arabic characters", () => {
			const result = isDangerousCommand("echo مرحبا بالعالم");
			expect(result.dangerous).toBe(false);
		});

		it("should handle mixed unicode and ASCII", () => {
			const result = isDangerousCommand("echo hello 日本語 world");
			expect(result.dangerous).toBe(false);
		});
	});

	describe("null bytes and control characters", () => {
		it("should handle null bytes in command", () => {
			const result = isDangerousCommand("echo test\0malicious");
			// null bytes should not bypass detection
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with carriage returns", () => {
			const result = isDangerousCommand("echo test\rmore");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with form feed", () => {
			const result = isDangerousCommand("echo test\fmore");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with vertical tab", () => {
			const result = isDangerousCommand("echo test\vmore");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with BEL character", () => {
			const result = isDangerousCommand("echo test\amore");
			expect(result.dangerous).toBe(false);
		});

		it("should handle command with backspace character", () => {
			const result = isDangerousCommand("echo test\bmore");
			expect(result.dangerous).toBe(false);
		});
	});

	describe("dangerous command edge cases", () => {
		it("should block rm -rf with extra whitespace", () => {
			const result = isDangerousCommand("rm   -rf   /");
			expect(result.dangerous).toBe(true);
		});

		it("should block rm -rf with tab separators", () => {
			const result = isDangerousCommand("rm\t-rf\t/");
			expect(result.dangerous).toBe(true);
		});

		it("should block sudo with mixed case", () => {
			const result = isDangerousCommand("Sudo rm -rf /");
			expect(result.dangerous).toBe(true);
		});

		it("should block eval with arguments", () => {
			const result = isDangerousCommand('eval "echo pwned"');
			expect(result.dangerous).toBe(true);
		});

		it("should block dangerous command buried in safe-looking prefix", () => {
			const result = isDangerousCommand("true && rm -rf /");
			expect(result.dangerous).toBe(true);
		});

		it("should block dangerous command with safe-looking suffix", () => {
			const result = isDangerousCommand("rm -rf / && true");
			expect(result.dangerous).toBe(true);
		});

		it("should block fork bomb variant", () => {
			const result = isDangerousCommand(":(){ :|:& };:");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("Fork bomb");
		});

		it("should allow safe git push", () => {
			const result = isDangerousCommand("git push origin main");
			expect(result.dangerous).toBe(false);
		});

		it("should block git push --force-with-lease (contains --force)", () => {
			const result = isDangerousCommand("git push --force-with-lease");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("Force push");
		});

		it("should allow safe apt install", () => {
			const result = isDangerousCommand("apt install nginx");
			expect(result.dangerous).toBe(false);
		});

		it("should block apt remove of critical services", () => {
			const result = isDangerousCommand("apt remove nginx");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("critical service");
		});

		it("should block apt purge of docker", () => {
			const result = isDangerousCommand("apt purge docker.io");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("critical service");
		});

		it("should block sudo with any command", () => {
			const result = isDangerousCommand("sudo ls");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("sudo");
		});

		it("should block nmap scanning", () => {
			const result = isDangerousCommand("nmap -sV 192.168.1.0/24");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("nmap");
		});

		it("should block dd disk write", () => {
			const result = isDangerousCommand("dd if=/dev/zero of=/dev/sda");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("disk write");
		});

		it("should block mkfs formatting", () => {
			const result = isDangerousCommand("mkfs.ext4 /dev/sda1");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("format");
		});

		it("should block fdisk partitioning", () => {
			const result = isDangerousCommand("fdisk /dev/sda");
			expect(result.dangerous).toBe(true);
		});

		it("should block DELETE FROM SQL", () => {
			const result = isDangerousCommand("DELETE FROM users WHERE 1=1");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("DELETE");
		});

		it("should block TRUNCATE TABLE SQL", () => {
			const result = isDangerousCommand("TRUNCATE TABLE logs");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("SQL");
		});

		it("should block xargs rm", () => {
			const result = isDangerousCommand("find . -name '*.tmp' | xargs rm");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("xargs rm");
		});

		it("should block base64 decode piped to bash", () => {
			const result = isDangerousCommand(
				"echo aGVsbG8= | base64 -d | bash",
			);
			expect(result.dangerous).toBe(true);
		});

		it("should allow safe echo command", () => {
			const result = isDangerousCommand("echo hello world");
			expect(result.dangerous).toBe(false);
		});

		it("should allow safe ls command", () => {
			const result = isDangerousCommand("ls -la /home/user");
			expect(result.dangerous).toBe(false);
		});

		it("should allow safe cat command", () => {
			const result = isDangerousCommand("cat /etc/hostname");
			expect(result.dangerous).toBe(false);
		});

		it("should allow safe grep command", () => {
			const result = isDangerousCommand("grep -r 'TODO' src/");
			expect(result.dangerous).toBe(false);
		});

		it("should allow safe find command", () => {
			const result = isDangerousCommand("find . -name '*.ts' -type f");
			expect(result.dangerous).toBe(false);
		});

		it("should block iptables flush", () => {
			const result = isDangerousCommand("iptables -F");
			expect(result.dangerous).toBe(true);
			expect(result.reason).toContain("Firewall");
		});

		it("should block iptables policy drop", () => {
			const result = isDangerousCommand("iptables -P DROP");
			expect(result.dangerous).toBe(true);
		});

		it("should block crontab edit", () => {
			const result = isDangerousCommand("crontab -e");
			expect(result.dangerous).toBe(true);
		});

		it("should block crontab remove", () => {
			const result = isDangerousCommand("crontab -r");
			expect(result.dangerous).toBe(true);
		});

		it("should block swap commands", () => {
			const result = isDangerousCommand("mkswap /dev/sda2");
			expect(result.dangerous).toBe(true);
		});

		it("should block swapon command", () => {
			const result = isDangerousCommand("swapon /dev/sda2");
			expect(result.dangerous).toBe(true);
		});
	});
});
