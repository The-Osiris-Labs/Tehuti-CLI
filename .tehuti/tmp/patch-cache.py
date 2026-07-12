#!/usr/bin/env python3
import sys

path = "src/cli/commands/chat.ts"
with open(path, "r") as f:
    src = f.read()

TAB = "\t"
old1 = (
    f"{TAB}const advisoryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(\n"
    f"{TAB}{TAB}new Set(),\n"
    f"{TAB});\n"
    f"{TAB}// Snapshot of message count when the user last scrolled up. We diff\n"
    f"{TAB}// against the current messages.length so the \"N new\" badge shows the\n"
    f"{TAB}// count of message *arrivals*, not the total."
)

new1 = (
    f"{TAB}const advisoryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(\n"
    f"{TAB}{TAB}new Set(),\n"
    f"{TAB});\n"
    f"{TAB}// Memoize the line-count estimate for the virtual scroll windowing logic\n"
    f"{TAB}// below. The estimate walks every message in `messages` and is O(messages)\n"
    f"{TAB}// per call. Without this cache, scrolling re-estimates all messages on\n"
    f"{TAB}// every keystroke, which dominates render time for 500+ message sessions.\n"
    f"{TAB}const lineEstimateCacheRef = useRef<Map<number, number>>(new Map());\n"
    f"{TAB}// Snapshot of message count when the user last scrolled up. We diff\n"
    f"{TAB}// against the current messages.length so the \"N new\" badge shows the\n"
    f"{TAB}// count of message *arrivals*, not the total."
)

if old1 not in src:
    print("ERR: old1 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old1, new1)

old2 = (
    f"{TAB}const visibleMessages = useMemo(() => {{\n"
    f"{TAB}{TAB}const linesNeeded = chatViewportHeight + scrollOffset + 20;\n"
    f"{TAB}{TAB}const avgCharsPerLine = Math.max(20, contentMaxWidth - 4);\n"
    f"{TAB}{TAB}const estimateMsgLines = (msg: any) => {{"
)

new2 = (
    f"{TAB}const visibleMessages = useMemo(() => {{\n"
    f"{TAB}{TAB}const linesNeeded = chatViewportHeight + scrollOffset + 20;\n"
    f"{TAB}{TAB}const avgCharsPerLine = Math.max(20, contentMaxWidth - 4);\n"
    f"{TAB}{TAB}const cache = lineEstimateCacheRef.current;\n"
    f"{TAB}{TAB}const liveIds = new Set<number>();\n"
    f"{TAB}{TAB}for (const m of messages) {{\n"
    f"{TAB}{TAB}{TAB}if (typeof m.id === \"number\") liveIds.add(m.id);\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}for (const cachedId of cache.keys()) {{\n"
    f"{TAB}{TAB}{TAB}if (!liveIds.has(cachedId)) cache.delete(cachedId);\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}const estimateMsgLines = (msg: any) => {{"
)

if old2 not in src:
    print("ERR: old2 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old2, new2)

old3 = (
    f"{TAB}{TAB}{TAB}if (!hasToolBlock) {{\n"
    f"{TAB}{TAB}{TAB}{TAB}l += msg.toolCalls.length * 8;\n"
    f"{TAB}{TAB}{TAB}}}\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}return l + 1;"
)

new3 = (
    f"{TAB}{TAB}{TAB}if (!hasToolBlock) {{\n"
    f"{TAB}{TAB}{TAB}{TAB}l += msg.toolCalls.length * 8;\n"
    f"{TAB}{TAB}{TAB}}}\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}if (typeof msg.id === \"number\") {{\n"
    f"{TAB}{TAB}{TAB}cache.set(msg.id, l);\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}return l + 1;"
)

if old3 not in src:
    print("ERR: old3 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old3, new3)

old4 = (
    f"{TAB}{TAB}return messages.slice(Math.max(0, sliceIndex - 10));\n"
    f"{TAB}}}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth]);"
)

new4 = (
    f"{TAB}{TAB}return messages.slice(Math.max(0, sliceIndex - 10));\n"
    f"{TAB}}}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth, lineEstimateCacheRef]);"
)

if old4 not in src:
    print("ERR: old4 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old4, new4)

with open(path, "w") as f:
    f.write(src)

print("Patched OK")
