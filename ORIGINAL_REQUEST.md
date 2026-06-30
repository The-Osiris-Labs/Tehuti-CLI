# Original User Request

## Initial Request — 2026-06-29T02:14:04+03:00

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

A massive architectural and visual overhaul of the Tehuti CLI agent harness to make it the ultimate, state-of-the-art terminal coding assistant. It must feature a stunning, highly polished Egyptian-themed Ink/React Terminal UI and an impenetrable, highly optimized agent core.

Working directory: `/Users/youssefsala7/Projects/Tehuti-CLI-Revival`
Integrity mode: development

## Requirements

### R1. Agent Core Hardening
Enhance the execution engine, parallel executor, context compressor, and prefetcher to be the most optimal in their class. Expand autonomous memory management capabilities so the agent can handle multi-day context spans natively.

### R2. Visual Excellence & TUI Polish
Upgrade the React/Ink TUI to be visually stunning. Enhance the Virtual Sliding Viewport, add smooth terminal micro-animations where possible, and perfect the Egyptian Gold/Obsidian color palette. The UI must feel completely premium and fluid.

### R3. Advanced Tooling Ecosystem
Expand the native tool suite to handle advanced codebase manipulation (e.g., AST parsing tools, semantic search) without relying on basic string matching or hardcoded paths. All tools must cleanly register via the new dynamic tools registry.

## Acceptance Criteria

### Testing & Integrity
- [ ] `npm test` must maintain a 100% pass rate (500+ tests) across all suites.
- [ ] `npm run build` must succeed without any TypeScript compilation errors.

### Visual Constraints
- [ ] The Virtual Sliding Viewport must not break line-wrapping or ANSI color codes during scroll interactions.
- [ ] UI overlays (Command Palette, Config Editor) must not overlap or corrupt the standard input buffer.
