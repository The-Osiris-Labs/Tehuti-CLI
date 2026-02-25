import "./api/http-agent.js";
import { createProgram } from "./cli/index.js";
import { showUpdateNotification } from "./utils/update-checker.js";

showUpdateNotification();

const program = createProgram();

program.parse(process.argv);
