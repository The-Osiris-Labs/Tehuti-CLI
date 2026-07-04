const { spawn } = require("child_process");
const proc = spawn("bash", ["-c", "echo 'Hello from Tehuti Bash!'"]);
let out = "";
proc.stdout.on("data", d => out += d);
proc.on("close", () => console.log("OUTPUT:", JSON.stringify(out.trim())));
