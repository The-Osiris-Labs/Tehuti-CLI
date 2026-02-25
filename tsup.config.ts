import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  dts: true,
  sourcemap: true,
  minify: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [
    "@lvce-editor/ripgrep",
    "fsevents",
  ],
  treeshake: true,
  outDir: "dist",
  shims: true,
});
