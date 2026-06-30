# BRIEFING — 2026-06-29T10:56:00+03:00

## Mission
Investigate keyboard input, shortcut handling, cursor navigation, command palette transitions, and input clash prevention in Tehuti CLI's chat TUI and produce a detailed report.

## 🔒 My Identity
- Archetype: Explorer
- Roles: Teamwork explorer
- Working directory: /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_3
- Original parent: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Milestone: keyboard-input-investigation

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Analyze keyboard input handling, shortcuts, cursor navigation, command palette transitions, and input clash prevention in src/cli/commands/chat.ts and related TUI files.

## Current Parent
- Conversation ID: 49ff51e0-e358-4bc0-9f42-073e23a84f50
- Updated: not yet

## Investigation State
- **Explored paths**:
  - `src/cli/commands/chat.ts`
  - `src/cli/ui/hooks/useChatInput.ts`
  - `src/cli/ui/components/CommandPalette.tsx`
  - `src/cli/ui/hooks/useChatState.ts`
  - `src/cli/ui/components/ConfigEditor.tsx`
  - `src/utils/mouse.ts`
  - `HANDOFF.md`
- **Key findings**:
  - **Vim Navigation Pollution**: Pressing 'j' or 'k' for Vim navigation in `CommandPalette` when the search query is empty successfully updates the selected index, but it is also intercepted by the focused `InkTextInput`, polluting the query with 'j' or 'k'.
  - **Text Selection Lifecycle Issues**: Cursor movement without Shift does not clear selection (arrow handlers return early). Typing, deleting, or pasting does not respect or clear selection, resulting in stale highlight overlays and incorrect edits.
  - **Ctrl+D Clean Exit Discrepancy**: Unlike Ctrl+C or `/exit`, pressing Ctrl+D when input is empty only triggers `onExit()` (MCP disconnect) but does not save session, output cost tracking, or call Ink's `exit()`, causing the program to hang.
  - **Auto-opening Command Palette Race Condition**: Typing '/' as the first character triggers command palette opening via asynchronous React state `setShowCommandPalette(true)`. In fast typing, subsequent keys typed in the same terminal tick are processed by the main chat input instead of the palette.
  - **Async Session Reset Race Condition**: Commands like `/clear` or `ctrl+l` execute `resetConversation()`, which asynchronously creates a new session. Since it is not awaited and input is not blocked, a user typing and pressing Enter immediately starts concurrent session creation, leading to duplicate/mismatched session and context states.
- **Unexplored areas**: None.

## Key Decisions Made
- Investigated all files relating to input loop, keyboard shortcuts, and state transitions.
- Formulated recommended solutions (e.g., ref-based toggling, state synchronization, input locking, and selection lifecycle handlers).

## Artifact Index
- /Users/youssefsala7/Projects/Tehuti-CLI-Revival/.agents/teamwork_preview_explorer_m4_3/handoff.md — Analysis and findings report.
