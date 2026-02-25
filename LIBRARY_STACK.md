# Tehuti CLI - Ultimate Library Stack

## Executive Summary

This document defines the absolute best library stack to transform Tehuti CLI into a world-class terminal experience, matching or exceeding Claude Code, Gemini CLI, and Qwen Code.

---

## Current State Analysis

### Already Installed ✓

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `ink` | 6.7.0 | React for CLI | ✓ Core |
| `chalk` | 5.4.1 | Terminal styling | ✓ Keep |
| `picocolors` | 1.1.0 | Fast colors | ✓ Keep |
| `consola` | 3.4.0 | Logging | ✓ Keep |
| `ora` | 9.3.0 | Spinner | ✓ Keep |
| `marked-terminal` | 7.3.0 | Markdown | ✓ Keep |
| `shiki` | 3.2.1 | Syntax highlighting | ✓ Better than emphasize! |
| `diff` | 8.0.1 | Diff generation | ✓ Keep |
| `supports-color` | 10.2.2 | Color detection | ✓ Keep |
| `is-unicode-supported` | 2.1.0 | Unicode detection | ✓ Keep |
| `@inquirer/prompts` | 8.2.1 | Interactive prompts | ✓ Keep |
| `update-notifier` | 7.3.1 | Update checks | ✓ Keep |
| `listr2` | 10.1.0 | Task lists | ✓ Keep |
| `sharp` | 0.34.5 | Image processing | ✓ Keep |

### Missing (Need to Install)

| Package | Purpose | Priority |
|---------|---------|----------|
| `ink-spinner` | Ink-native animated spinner | **Critical** |
| `ink-text-input` | Enhanced input with history | High |
| `ink-select-input` | Command palette | Medium |
| `ink-table` | Tabular data display | Medium |
| `figlet` | ASCII art generation | Medium |
| `gradient-string` | Color gradients | Medium |
| `wrap-ansi` | Text wrapping with ANSI | High |
| `cli-truncate` | Truncation with ellipsis | High |
| `string-width` | Visual width calculation | High |
| `cli-spinners` | Spinner definitions | Medium |
| `terminal-link` | Clickable hyperlinks | Low |

---

## 1. Core Terminal UI Framework

### Current: Ink (React-based) ✓
**Status:** Already implemented - STAY with Ink

**Why Ink:**
- Used by Claude Code, Gemini CLI, Qwen Code, OpenAI Codex
- 28.6k GitHub stars, mature ecosystem
- React component model - familiar paradigm
- Flexbox layouts via Yoga
- TypeScript first-class support

**Alternative Consideration:** OpenTUI (8.8k stars)
- Native Zig performance
- Used by OpenCode
- **Decision:** Stay with Ink for ecosystem maturity, evaluate OpenTUI for v2

### Required Ink Ecosystem Additions

| Package | Version | Purpose | Weekly Downloads |
|---------|---------|---------|------------------|
| `ink-spinner` | 5.0.0 | Animated spinners | 1.6M |
| `ink-text-input` | 6.0.0 | Input with history | 898k |
| `ink-select-input` | 6.2.0 | Command palette | 590k |
| `ink-table` | 3.1.0 | Tabular data display | - |
| `@inkjs/ui` | latest | Official UI components | - |

```bash
npm install ink-spinner ink-text-input ink-select-input ink-table @inkjs/ui
```

---

## 2. Terminal Styling (Colors)

### Current: chalk ✓
**Recommendation:** Migrate to `picocolors` for performance

| Library | Size | Performance | Features |
|---------|------|-------------|----------|
| `picocolors` | 1.2KB | **Fastest** | Core colors, NO_COLOR support |
| `colorette` | 2.8KB | 2x faster than chalk | Auto-detection, TypeScript |
| `chalk` | 13KB | Baseline | Full features, chainable |

**Benchmark (ops/sec):**
- picocolors: 2,841,512
- colorette: 2,512,634
- chalk: 1,284,756

**Recommendation:** Use `picocolors` for hot paths, `chalk` for complex styling

```bash
npm install picocolors
```

---

## 3. Markdown Rendering

### Current: Handcoded `renderMarkdown()` at `chat.ts:140-254`
**Recommendation:** Replace with `marked-terminal`

| Feature | marked-terminal | Handcoded |
|---------|-----------------|-----------|
| GFM Tables | ✅ | ❌ |
| Blockquotes | ✅ | ❌ |
| Task lists | ✅ | ❌ |
| Strikethrough | ✅ | ❌ |
| Syntax highlighting | ✅ Pluggable | Basic |
| Weekly downloads | 4.3M | - |
| Dependencies | marked | None |

```bash
npm install marked marked-terminal
```

**Alternative:** `markdansi` (Node 22+, zero-dep, GFM support)

```typescript
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal({
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  table: { borderColor: 'gray' }
}));

const rendered = marked.parse(markdownContent);
```

---

## 4. Syntax Highlighting

### Current: Handcoded `highlightSyntax()` at `chat.ts:64-137`
**Recommendation:** Replace with `emphasize`

| Library | Languages | Auto-detect | ANSI Output | Themes |
|---------|-----------|-------------|-------------|--------|
| `emphasize` | 190+ | ✅ | ✅ | Multiple |
| `cli-highlight` | 175+ | ✅ | ✅ | Multiple |
| Handcoded | ~10 | ❌ | ✅ | 1 |

```bash
npm install emphasize
```

```typescript
import { emphasize } from 'emphasize';

const highlighted = emphasize.highlight('typescript', code).value;
```

---

## 5. Animated Loading States

### Current: None (static "Thinking...")
**Recommendation:** `ora` + `cli-spinners`

| Package | Purpose | Downloads |
|---------|---------|-----------|
| `ora` | Elegant spinner wrapper | 54.4M |
| `cli-spinners` | 70+ spinner definitions | 22.6M |
| `ink-spinner` | Ink-native spinner | 1.6M |

```bash
npm install ora cli-spinners
```

**Ink Integration:**
```tsx
import Spinner from 'ink-spinner';

<Box>
  <Spinner type="dots" />
  <Text> Thinking...</Text>
</Box>
```

**Available spinners:** dots, line, circle, monkey, moon, time, arrow, bouncing, etc.

---

## 6. Interactive Prompts

### Current: `@inquirer/prompts` ✓
**Status:** Already implemented - ENHANCE

**Add components:**
```bash
npm install @inquirer/confirm @inquirer/select @inquirer/expand @inquirer/password
```

**Usage in permissions:**
```typescript
import { confirm } from '@inquirer/confirm';

const allow = await confirm({
  message: `Allow ${toolName} to write to ${filePath}?`,
  default: false,
});
```

---

## 7. Text Utilities

### Current: None/Handcoded
**Recommendation:** Add full terminal text utility stack

| Package | Purpose | Downloads |
|---------|---------|-----------|
| `wrap-ansi` | Word wrap with ANSI preservation | 114.8M |
| `cli-truncate` | Truncate with ellipsis | 36.2M |
| `string-width` | Visual width calculation | 61.3M |
| `slice-ansi` | Slice strings with ANSI | 48.7M |
| `strip-ansi` | Remove ANSI codes | 144.8M |

```bash
npm install wrap-ansi cli-truncate string-width slice-ansi strip-ansi
```

**Example:**
```typescript
import wrapAnsi from 'wrap-ansi';
import cliTruncate from 'cli-truncate';
import stringWidth from 'string-width';

// Wrap text at 80 columns, preserving colors
const wrapped = wrapAnsi(chalk.red('long colored text...'), 80);

// Truncate to fit terminal
const truncated = cliTruncate('very long string', process.stdout.columns - 10);

// Get visual width (handles emojis, CJK)
const width = stringWidth('Hello 🌍 世界');
```

---

## 8. ASCII Art / Branding

### Current: Static hardcoded ASCII
**Recommendation:** `figlet` + `gradient-string`

| Package | Purpose | Fonts |
|---------|---------|-------|
| `figlet` | ASCII art text generation | 287+ fonts |
| `gradient-string` | Color gradients | 30+ presets |

```bash
npm install figlet gradient-string
```

```typescript
import figlet from 'figlet';
import gradient from 'gradient-string';

const ascii = figlet.textSync('TEHUTI', { 
  font: 'ANSI Shadow',
  horizontalLayout: 'default'
});

const branded = gradient.rainbow(ascii);
console.log(branded);
```

**Popular fonts:** ANSI Shadow, Big, Doom, Isometric1, Slant, Small, Standard

---

## 9. Diff Preview

### Current: None
**Recommendation:** `diff` package with custom ANSI colorization

```bash
npm install diff
```

```typescript
import * as Diff from 'diff';
import chalk from 'chalk';

function colorizeDiff(patch: string): string {
  return patch
    .split('\n')
    .map(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return chalk.green(line);
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        return chalk.red(line);
      }
      if (line.startsWith('@@')) {
        return chalk.cyan(line);
      }
      return chalk.dim(line);
    })
    .join('\n');
}

const patch = Diff.createPatch('file.ts', oldContent, newContent);
console.log(colorizeDiff(patch));
```

---

## 10. Terminal Utilities

| Package | Purpose |
|---------|---------|
| `terminal-link` | Clickable OSC 8 hyperlinks |
| `ansi-escapes` | ANSI escape sequences |
| `supports-color` | Detect color support level |
| `is-unicode-supported` | Detect Unicode support |

```bash
npm install terminal-link ansi-escapes supports-color is-unicode-supported
```

```typescript
import terminalLink from 'terminal-link';
import supportsColor from 'supports-color';

// Clickable link
const link = terminalLink('OpenRouter', 'https://openrouter.ai');

// Color support detection
if (supportsColor.stdout.has256) {
  // Use 256 colors
}
```

---

## 11. Logging

### Current: `consola` ✓
**Status:** Keep consola for CLI, consider `pino` for production logs

| Library | Performance | Use Case |
|----------|-------------|----------|
| `consola` | Good | CLI apps, development |
| `pino` | Fastest | Production, high-throughput |
| `winston` | Slowest | Enterprise, multiple transports |

**Consola is ideal for CLI tools** - keep it.

---

## 12. Progress Indicators

| Package | Purpose | Downloads |
|---------|---------|-----------|
| `cli-progress` | Progress bars | 8.1M |
| `listr2` | Task lists with progress | 3.2M |

```bash
npm install cli-progress
```

---

## Complete Installation Command

```bash
# Core Ink ecosystem
npm install ink-spinner ink-text-input ink-select-input ink-table @inkjs/ui

# Markdown & Syntax
npm install marked marked-terminal emphasize

# Animation & Loading
npm install ora cli-spinners

# Inquirer enhancements
npm install @inquirer/confirm @inquirer/select @inquirer/expand

# Terminal utilities
npm install picocolors wrap-ansi cli-truncate string-width slice-ansi strip-ansi terminal-link ansi-escapes supports-color is-unicode-supported

# ASCII Art
npm install figlet gradient-string

# Diff preview
npm install diff

# Progress
npm install cli-progress
```

---

## Library Comparison Matrix

| Category | Current | Recommended | Why |
|----------|---------|-------------|-----|
| UI Framework | Ink ✓ | Ink + ink-ui | Add official components |
| Colors | chalk | picocolors | 2x faster |
| Markdown | Handcoded | marked-terminal | Full GFM support |
| Syntax | Handcoded | emphasize | 190+ languages |
| Spinner | None | ora + ink-spinner | Professional animations |
| Prompts | @inquirer ✓ | @inquirer ✓ | Already best |
| Text Utils | None | wrap-ansi, cli-truncate | Essential for CLI |
| ASCII Art | Static | figlet + gradient-string | Dynamic branding |
| Diff | None | diff + chalk | Preview before apply |
| Logging | consola ✓ | consola ✓ | Ideal for CLI |

---

## Migration Priority

### Phase 1: Critical UX (Week 1)
1. `ink-spinner` - Replace static "Thinking..."
2. `picocolors` - Performance improvement
3. `wrap-ansi`, `cli-truncate` - Proper text handling
4. Wire `@inquirer/confirm` for permissions

### Phase 2: Rich Content (Week 2)
5. `marked-terminal` - Replace handcoded markdown
6. `emphasize` - Replace handcoded syntax
7. `figlet` + `gradient-string` - Dynamic branding
8. `diff` - Preview before edits

### Phase 3: Polish (Week 3)
9. `ink-table` - Structured data display
10. `ink-text-input` - Enhanced input with history
11. `ink-select-input` - Command palette
12. `terminal-link` - Clickable links

---

## Final Architecture

```
Tehuti CLI Stack:
├── Core Framework: Ink + React
├── UI Components: @inkjs/ui, ink-spinner, ink-text-input, ink-table
├── Styling: picocolors (hot paths), chalk (complex)
├── Content: marked-terminal + emphasize
├── Animation: ora + cli-spinners
├── Prompts: @inquirer/prompts
├── Text Utils: wrap-ansi, cli-truncate, string-width
├── Branding: figlet + gradient-string
├── Preview: diff + chalk
├── Logging: consola
└── Utilities: terminal-link, ansi-escapes, supports-color
```

This stack matches or exceeds what Claude Code, Gemini CLI, and Qwen Code use internally.
