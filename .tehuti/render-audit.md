# Tehuti Rendering Audit

Audit of every user-visible surface in the TUI. Severity: 🔴 P0 (broken/embarrassing) → 🟡 P1 (ugly/awkward) → 🟢 P2 (polish).

## 🔴 P0 — Worst offenders

### 1. Tables are plain `│` borders with no Unicode alignment and no color
**File:** `src/cli/ui/markdown-mapper.tsx` lines 199-250
**Problem:** The `table` renderer uses `Math.max(headerLen, ...rowLens)` based on `stringWidth()` for cell widths, but the cell text is written raw — **no padding is applied to the left side**, only the right (`padEndWidth`). Long cell content wraps visually but the table layout does not account for it. Worse, the text is rendered through `wrap="wrap"` inside a single `Text` element, so the table **does not actually align when a cell wraps** — line 2+ of a wrapped cell will break the vertical `│` borders. The table looks "okay" for short data and falls apart for any real-world content.
**Fix plan:** Build the table as an array of pre-wrapped `Text` lines with one `Text` per row, computing cell widths AFTER word-wrapping. Apply per-line padding so borders stay aligned.

### 2. Tool output preview box uses ASCII `│` instead of the brand's hieroglyphic frame
**File:** `src/cli/commands/chat.ts` lines 352-366, 3875-3882 (`formatToolResult` + `onToolResult`)
**Problem:** The "expanded" tool result preview shows raw `  │ ` line prefixes with no color, no header, and a `truncated for display` middle-cut that **fractures tool output mid-syntax** (e.g. cutting a JSON value at a random column). The brand has `DECORATIVE` hieroglyphs and `BRANDING.colors` but the non-TUI streaming fallback uses plain dim text. The TUI-side `ExpandableToolOutput` does have styling, but the `--json`/non-TUI path doesn't.
**Fix plan:** Use the brand colors. Replace middle-truncation with line-truncation (keep whole lines, never split tokens).

### 3. Reasoning blocks have a hand-drawn box but the box is misaligned when content wraps
**File:** `src/cli/commands/chat.ts` lines 3040-3086, 3089-3134, 3170-3215
**Problem:** Three near-identical copies of "render a reasoning block with a `┌─[ 𓁹 Reasoning ]─────` top and `└───────────` bottom". The top border's `borderLine` is computed once at `contentMaxWidth - 22`, but the bottom border uses `contentMaxWidth - 4`. So the box is **asymmetric** (top short, bottom wide). Also: the `┌─[` and `]─` characters don't perfectly align with the box width when the content wraps to multiple lines.
**Fix plan:** Extract a single `ReasoningBlock` component, make top and bottom borders the same width, ensure borders span the same `contentMaxWidth`.

### 4. Markdown code blocks have a `lang` label inside the box but the code itself is `dimColor`
**File:** `src/cli/ui/markdown-mapper.tsx` lines 94-113
**Problem:** The code box is rendered with `borderColor: GRAY` and the actual code is `dimColor: true`. So you get a gray box containing dimmed gray code on a black background — **terrible contrast** (often unreadable). The highlighter (`highlightToAnsi`) is applied first, so the ANSI colors *should* come through, but then `dimColor: true` at the Text level dims the whole thing, defeating the syntax coloring.
**Fix plan:** Drop `dimColor` on the code Text. Let the highlighter drive color. Border can stay gray or move to a darker neutral.

## 🟡 P1 — Visible ugliness

### 5. Cost summary mixes multiple hieroglyphs inline with English text
**File:** `src/api/cost.ts` line 164-165
```
𓆣 Session Summary:
  𓊖 Requests: 5 𓍋 Tokens: 12,345 𓂝 Cost: $0.0123
```
**Problem:** The hieroglyphs act as inline separators which is novel, but the rendering depends on the terminal font supporting those specific hieroglyphs. In most terminals they show as `□` tofu boxes. The cache line uses `𓏛` which is in the same boat.
**Fix plan:** Use ASCII/box-drawing separators (`·`, `│`, ` • `) that render universally. Keep one prominent hieroglyph at the section title only.

### 6. Session list has hard-coded box width `84` chars regardless of terminal width
**File:** `src/cli/ui/components/SessionList.tsx` lines 169, 187, 202
**Problem:** `┌${"─".repeat(84)}┐` and the column widths (`idText 8 + nameText 20 + msgText 6 + tokenText 8 + modelText 20 + dateText 12` = 74 chars + 7 separators = 81 chars inside the 86-wide box). The footer uses `width={86}` which **exceeds most terminal widths on smaller screens** and causes wrapping. The `pad()` function truncates with no ellipsis.
**Fix plan:** Compute widths from `useStdout().columns`. Truncate with `…` instead of dropping characters.

### 7. Parallel tool results render as a vertical stack, not side-by-side
**File:** `src/cli/commands/chat.ts` lines 3219-3241
**Problem:** When multiple tool calls land in the same turn (`m.toolCalls.length > 1`), each is rendered as a separate `ExpandableToolOutput` stacked vertically. This wastes vertical space and makes it hard to compare parallel tool outputs. A side-by-side or 2-column grid would be much more readable.
**Fix plan:** Render parallel tool calls in a flex row with `flexWrap: "wrap"` and per-card width (`min(60, contentMaxWidth / n)`).

### 8. Streaming output manager's code-block detection is fragile
**File:** `src/terminal/buffered-writer.ts` lines 339-342
```ts
private detectsCodeBlockBoundary(token: string): boolean {
  return /```[a-zA-Z]*/.test(token);
}
```
**Problem:** The regex matches `\`\`\`` followed by zero or more ASCII letters. It **fails to detect**:
- Language tags with digits (`\`\`\`ts5`? no, but `\`\`\`svelte` is fine)
- Closing fences with nothing after them
- Fences that are split across tokens (the streaming API may emit `\`\`\`` and `ts` in separate chunks)
- Code blocks without language tags at all

This causes partial code blocks to be rendered as plain text mid-stream, then re-rendered correctly when the boundary finally arrives.
**Fix plan:** Track fence count parity across tokens. Use a `seenBackticks: number` counter that flips on each `\`\`\``.

### 9. Tool icon map is incomplete — falls back to `🔧` (wrench)
**File:** `src/cli/commands/chat.ts` lines 229-308 (`formatToolCall`)
**Problem:** The function has a switch over `read/write/edit/bash/glob/grep/webfetch/web_search` and falls through to `🔧` for anything else. Tools like `acp_message`, `create_plan`, `apply_diff`, `git_*`, `npm_*`, `todowrite`, `task`, `bash_background`, `list_sessions`, etc. all show the same wrench icon. The user can't distinguish tools at a glance.
**Fix plan:** Build a comprehensive `TOOL_ICONS` map at module top with semantic icons for every registered tool.

### 10. Error states in `formatToolResult` fall back to the error field only when `output` is empty
**File:** `src/cli/commands/chat.ts` lines 333-338
**Problem:** Currently a failed tool with `output: "partial stdout"` + `error: "exit code 1"` will show the partial stdout, not the error. The error is invisible. Same logic exists in `ExpandableToolOutput.summarizeToolOutput`.
**Fix plan:** When `success === false`, show BOTH output and error (output as context, error prominently). Or at least show a red error summary line.

### 11. Question prompt has visual inconsistency in custom-input mode
**File:** `src/cli/ui/components/QuestionPrompt.tsx` lines 122-124
```tsx
React.createElement(Text, { color: CORAL }, `> ${customInput}\u2588`),
```
**Problem:** Uses `\u2588` (full block) for the cursor. The rest of the app uses `\x1b[?25h` (real cursor) via the streaming writer. Two cursor paradigms in one app.
**Fix plan:** Use a normal `<Text>` cursor OR keep the block cursor but match it to the regular input prompt's style.

## 🟢 P2 — Polish

### 12. Headers/footers use hieroglyphs that don't render in all terminals
**File:** `src/cli/ui/components/TehutiHeader.tsx`, `MediaViewer.tsx`, `StatusIndicator.tsx`
**Problem:** `𓆣`, `𓂀`, `𓁹`, `𓏛` — many of these are outside the BMP and need a font like `Noto Sans Egyptian Hieroglyphs` to render. In TUI environments they often show as boxes. Should provide ASCII fallbacks via `process.env.TEHUTI_ASCII_MODE`.
**Fix plan:** Add a `useAsciiMode()` hook backed by env detection and a brand-level toggle.

### 13. TodoList icon/age text wraps awkwardly on long IDs
**File:** `src/cli/ui/components/TodoList.tsx` lines 74-82
**Problem:** `[id] 𓂀 [Deep Memory] 🟡 [3m ago] content` — no spacing strategy for long content, no wrapping, gets cut off by viewport.
**Fix plan:** Truncate ID to 6 chars, move age to a right-aligned dim column.

### 14. SwarmVisualizer uses non-uniform column widths
**File:** `src/cli/ui/components/SwarmVisualizer.tsx` lines 75-101
**Problem:** `flexBasis={12}` for AGENT ID, `15` for ROLE, `10` for STATUS, `20` for TASK, `10` for TOKENS. But the values (especially the prompt preview) can be longer than the column, causing overflow into adjacent columns because flexBasis is just a hint.
**Fix plan:** Use `width` instead of `flexBasis` for fixed-width columns; `wrap="truncate-end"` for the prompt column.

### 15. Reasoning box duplicated 3 times
**File:** `src/cli/commands/chat.ts` lines 3039-3215
**Problem:** ~180 lines of near-identical code, three slightly different versions. Any fix has to be applied three times. Pure DRY violation.
**Fix plan:** Extract `renderReasoningBlock(content, contentMaxWidth, key)` helper.

---

## Recommended fix priority

1. **P0-1** Tables alignment/wrapping — used constantly
2. **P0-3** Reasoning box asymmetry — used constantly  
3. **P0-4** Code blocks dim + low contrast — used constantly
4. **P0-2** Tool output preview box & middle-truncation — used constantly
5. **P1-7** Parallel tool results side-by-side layout
6. **P1-9** Tool icon map completeness

(P1-5, P1-6, P1-8, P1-10, P1-11, and the P2s can follow in a second pass.)
