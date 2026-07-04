import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mod = require("./dist/tehuti-core.darwin-arm64.node");
console.log(Object.keys(mod));
