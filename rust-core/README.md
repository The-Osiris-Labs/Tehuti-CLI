# Tehuti Rust Core

Currently, this core is compiled as a `.node` binary using NAPI-RS for Node.js integration.

## Future Compilation Target: `wasm32-wasip1-threads`

This package is being prepared for a transition to WebAssembly, specifically the `wasm32-wasip1-threads` target. This will allow the core logic to be run in a sandboxed, portable environment with multi-threading support, decoupling it from native OS-specific binaries.

### Preparation Notes:
- **Dependencies:** When switching, ensure crates like `rayon` and `tokio` are configured or replaced with WASI-compatible alternatives. `rayon` might need specific thread-pool initialization for WASI.
- **Build Target:** The target will change to `wasm32-wasip1-threads`.
- **Bindings:** NAPI-RS bindings (`[lib] crate-type = ["cdylib"]`) will need to be adapted or replaced with WASM bindings (like `wasm-bindgen` or direct WASI exports) depending on the runtime.
