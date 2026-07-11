import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function generateLaunchAgentPlist(): string {
	const nodePath = process.execPath;
	// Use the main CLI entry point
	const cliScript = process.argv[1];

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tehuti.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${cliScript}</string>
        <string>daemon</string>
        <string>_run_server</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), ".tehuti", "tehutid.err.log")}</string>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), ".tehuti", "tehutid.out.log")}</string>
</dict>
</plist>`;
}

export function installLaunchAgent(): void {
	const plistContent = generateLaunchAgentPlist();
	const agentDir = path.join(os.homedir(), "Library", "LaunchAgents");

	if (!fs.existsSync(agentDir)) {
		fs.mkdirSync(agentDir, { recursive: true });
	}

	const plistPath = path.join(agentDir, "com.tehuti.daemon.plist");
	fs.writeFileSync(plistPath, plistContent, "utf-8");
}
