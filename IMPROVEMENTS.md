# Tehuti CLI - Improvements & Library Recommendations

> **See also:** [LIBRARY_STACK.md](./LIBRARY_STACK.md) for the complete library stack with installation commands.

## Visual/UX Issues

### Critical (Must Fix)

| Issue | Location | Current | Impact |
|-------|----------|---------|--------|
| Static "Thinking..." no animation | `chat.ts:890` | Plain text | Users think app is frozen |
| No tool execution visualization | `chat.ts:784-789` | `[tool_name]` text | No progress feedback |
| Gray `#6B7280` fails WCAG AA | `chat.ts:23` | 4.2:1 contrast | Poor readability |
| `setQuestionResolver()` not wired | `system.ts` | Interactive questions don't reach user | Broken feature |

### High

| Issue | Location | Current | Impact |
|-------|----------|---------|--------|
| No multiline input | `chat.ts:834-842` | Single line only | Can't paste complex prompts |
| No tab completion | - | None | Poor UX for `/commands` |
| `globalMarkdownKey` React warnings | `chat.ts:138` | Mutable global | Key conflicts |
| No markdown tables/blockquotes | `chat.ts:140-254` | Missing | Broken rendering |

### Medium

| Issue | Location | Current | Impact |
|-------|----------|---------|--------|
| ASCII box misaligned | `branding/index.ts:14-19` | Left 5, right 20 chars | Looks broken |
| Ibis glyph `𓆣` boxes | `branding/index.ts:16` | Unicode | No fallback |
| Model name truncated | `chat.ts:857` | `glm-4.5` vs full | Info loss |
| No MCP status indicator | `chat.ts:853-861` | Missing | Can't see MCP state |
| Single-line errors | `chat.ts:889` | Red text only | No remediation |
| Confusing scroll indicator | `chat.ts:847` | `[1-5/12 ↑↓ scroll]` | Unclear |

---

## Functional Gaps

### Missing Features

| Feature | Gap | Priority |
|---------|-----|----------|
| Diff preview before edits | `editFile()` applies directly | **Critical** |
| Multi-file batch ops | Single-file schemas only | High |
| Image paste in chat | Only filesystem images | High |
| Real-time token display | Only `/cost` shows totals | Medium |
| "Remember session" permissions | Single yes/no | Medium |
| Resume-from-interruption | No stream resume | Medium |

### Partial Implementations

| Feature | Status | Issue |
|---------|--------|-------|
| Thinking display | Limited 200 chars | Needs full display |
| Tool visualization | Text only | Needs structured panels |
| Permission prompts | Trust mode default | Needs interactive allow/deny |

---

## Recommended Libraries (Replace Handcoded Code)

### 1. Terminal UI Framework

**Current:** Ink (React-based) - Already using ✓

**Alternative Consideration:** OpenTUI (Zig + TypeScript)
- 8,798 stars, actively maintained
- Native performance (written in Zig)
- Used by OpenCode, terminal.shop
- **Recommendation:** Stay with Ink for now (ecosystem maturity), evaluate OpenTUI for v2

**Ink Enhancements to Add:**
```bash
npm install ink-spinner ink-text-input ink-select ink-progress-bar
```

| Component | Library | Replaces |
|-----------|---------|----------|
| Spinner | `ink-spinner` | Handcoded "Thinking..." |
| Text Input | `ink-text-input` | Custom input handling |
| Select | `ink-select` | Command palette |
| Progress | `ink-progress-bar` | Tool execution |

### 2. Markdown Rendering

**Current:** Handcoded `renderMarkdown()` at `chat.ts:140-254`

**Recommended:** `marked-terminal`
```bash
npm install marked marked-terminal
```

| Feature | marked-terminal | Handcoded |
|---------|-----------------|-----------|
| Tables | ✅ | ❌ |
| Blockquotes | ✅ | ❌ |
| Task lists | ✅ | ❌ |
| GFM support | ✅ | ❌ |
| Syntax highlight | ✅ (pluggable) | Basic |
| Weekly downloads | 4.3M | - |

**Alternative:** `markdansi` (newer, lighter, Node 22+)

### 3. Syntax Highlighting

**Current:** Handcoded `highlightSyntax()` at `chat.ts:64-137`

**Recommended:** `emphasize` or `cli-highlight`
```bash
npm install emphasize  # Based on lowlight, 190+ languages
# OR
npm install cli-highlight  # Simpler API
```

| Feature | emphasize | cli-highlight | Handcoded |
|---------|-----------|---------------|-----------|
| Languages | 190+ | 175+ | ~10 |
| Auto-detect | ✅ | ✅ | ❌ |
| Themes | Multiple | Multiple | Hardcoded |
| ANSI output | ✅ | ✅ | ✅ |

### 4. Spinner/Progress Animation

**Current:** None (static text)

**Recommended:** `ora` + `cli-spinners`
```bash
npm install ora cli-spinners
```

```javascript
import ora from 'ora';
import cliSpinners from 'cli-spinners';

// 70+ spinner styles
const spinner = ora({
  text: 'Thinking...',
  spinner: cliSpinners.dots,  // ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
}).start();
```

| Feature | ora | Handcoded |
|---------|-----|-----------|
| Spinner styles | 70+ | 0 |
| Colors | ✅ | ✅ |
| Persist states | succeed/fail/warn | ❌ |
| Promise support | ✅ | ❌ |
| Weekly downloads | 54.4M | - |

### 5. Interactive Prompts

**Current:** Using `@inquirer/prompts` ✓ (already in deps)

**Enhance with:**
```bash
npm install @inquirer/confirm @inquirer/select @inquirer/expand
```

**Wire up permission prompts:**
```javascript
import { confirm } from '@inquirer/confirm';

const answer = await confirm({
  message: `Allow ${toolName} to modify files?`,
  default: false,
});
```

### 6. Diff Preview

**Current:** None

**Recommended:** `diff-so-fancy` for ANSI diffs
```bash
npm install diff-so-fancy
```

**Alternative for in-terminal:** `disparity-colors` or custom with `diff` package:
```bash
npm install diff
```

```javascript
import * as Diff from 'diff';

const patch = Diff.createPatch('file.ts', oldContent, newContent);
// Colorize with chalk: +green, -red
```

### 7. Terminal Utilities

**Already have:** `chalk`, `consola`

**Add:**
```bash
npm install terminal-link  # Clickable links
npm install cli-truncate   # Truncate with ellipsis
npm import string-width    # Proper string width (Unicode aware)
```

---

## Implementation Priority

### Phase 1: Critical UX Fixes (Week 1)

1. **Add animated spinner** (ora + cli-spinners)
   - Replace static "Thinking..."
   - Show tool execution with spinners
   - File: `src/cli/commands/chat.ts`

2. **Fix color contrast**
   - Change `GRAY = "#6B7280"` to `GRAY = "#9CA3AF"`
   - File: `src/cli/commands/chat.ts:23`

3. **Wire question resolver**
   - Connect `setQuestionResolver()` to ChatUI
   - File: `src/agent/tools/system.ts`, `src/cli/commands/chat.ts`

### Phase 2: Library Migrations (Week 2)

4. **Replace markdown renderer**
   - Install `marked-terminal`
   - Remove handcoded `renderMarkdown()`
   - File: `src/cli/commands/chat.ts`

5. **Replace syntax highlighter**
   - Install `emphasize`
   - Remove handcoded `highlightSyntax()`
   - File: `src/cli/commands/chat.ts`

6. **Add diff preview**
   - Install `diff`
   - Add preview step in `editFile()`
   - File: `src/agent/tools/fs.ts`

### Phase 3: Enhanced Features (Week 3)

7. **Add ink-ui components**
   - Install `ink-spinner`, `ink-text-input`
   - Refactor input handling
   - File: `src/cli/commands/chat.ts`

8. **Add tab completion**
   - For `/commands`
   - For file paths

9. **Fix ASCII art**
   - Proper alignment
   - ASCII fallback for Unicode

---

## Library Summary Table

| Category | Current | Recommended | Weekly Downloads | Reason |
|----------|---------|-------------|------------------|--------|
| UI Framework | Ink | Ink + ink-ui | 28.6k / 1.4k | Already using, add components |
| Markdown | Handcoded | marked-terminal | 4.3M | Full GFM support |
| Syntax Highlight | Handcoded | emphasize | 280k | 190+ languages |
| Spinner | None | ora | 54.4M | 70+ styles, proven |
| Prompts | @inquirer | @inquirer ✓ | 17M | Already using |
| Diff Preview | None | diff + diff-so-fancy | 28M | Proper diff display |
| Terminal Utils | chalk | + terminal-link, cli-truncate | 5M+ | Better UX |

---

## Migration Commands

```bash
# Install all recommended libraries
npm install marked marked-terminal emphasize ora cli-spinners diff terminal-link cli-truncate string-width

# Ink enhancements
npm install ink-spinner ink-text-input

# Verify
npm test
npm run build
```
