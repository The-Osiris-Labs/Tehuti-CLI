#!/usr/bin/env python3
"""Apply two chat.ts fixes in one shot:
1. Track advisory setTimeout timers in a Set ref + clear in useEffect
2. Memoize line-count estimate for virtual scroll windowing
"""
import sys

path = "src/cli/commands/chat.ts"
with open(path, "r") as f:
    src = f.read()

TAB = "\t"

# Patch 1: Add advisoryTimersRef right after advisoryIdRef
old1 = (
    f"{TAB}const advisoryIdRef = useRef(0);\n"
    f"{TAB}// Snapshot of message count when the user last scrolled up. We diff"
)

new1 = (
    f"{TAB}const advisoryIdRef = useRef(0);\n"
    f"{TAB}// Track each advisory's dismiss-timer so we can cancel them all on\n"
    f"{TAB}// unmount and avoid setState on an unmounted component (React warning,\n"
    f"{TAB}// potential state inconsistency).\n"
    f"{TAB}const advisoryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(\n"
    f"{TAB}{TAB}new Set(),\n"
    f"{TAB});\n"
    f"{TAB}// Memoize the line-count estimate for the virtual scroll windowing logic\n"
    f"{TAB}// below. The estimate walks every message in `messages` and is O(messages)\n"
    f"{TAB}// per call. Without this cache, scrolling re-estimates all messages on\n"
    f"{TAB}// every keystroke, which dominates render time for 500+ message sessions.\n"
    f"{TAB}const lineEstimateCacheRef = useRef<Map<number, number>>(new Map());\n"
    f"{TAB}// Snapshot of message count when the user last scrolled up. We diff"
)

if old1 not in src:
    print("ERR: old1 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old1, new1)

# Patch 2: Track the setTimeout in advisory handler
old2 = (
    f"{TAB}{TAB}{TAB}else if (msg.type === \"advisory\") {{\n"
    f"{TAB}{TAB}{TAB}{TAB}const id = advisoryIdRef.current++;\n"
    f"{TAB}{TAB}{TAB}{TAB}setAdvisories((prev) => [...prev, {{ id, text: msg.message }}]);\n"
    f"{TAB}{TAB}{TAB}{TAB}setTimeout(() => {{\n"
    f"{TAB}{TAB}{TAB}{TAB}{TAB}setAdvisories((prev) => prev.filter((a) => a.id !== id));\n"
    f"{TAB}{TAB}{TAB}{TAB}}}, 8000);\n"
    f"{TAB}{TAB}{TAB}}}"
)

new2 = (
    f"{TAB}{TAB}{TAB}else if (msg.type === \"advisory\") {{\n"
    f"{TAB}{TAB}{TAB}{TAB}const id = advisoryIdRef.current++;\n"
    f"{TAB}{TAB}{TAB}{TAB}setAdvisories((prev) => [...prev, {{ id, text: msg.message }}]);\n"
    f"{TAB}{TAB}{TAB}{TAB}const timer = setTimeout(() => {{\n"
    f"{TAB}{TAB}{TAB}{TAB}{TAB}advisoryTimersRef.current.delete(timer);\n"
    f"{TAB}{TAB}{TAB}{TAB}{TAB}setAdvisories((prev) => prev.filter((a) => a.id !== id));\n"
    f"{TAB}{TAB}{TAB}{TAB}}}, 8000);\n"
    f"{TAB}{TAB}{TAB}{TAB}advisoryTimersRef.current.add(timer);\n"
    f"{TAB}{TAB}{TAB}}}"
)

if old2 not in src:
    print("ERR: old2 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old2, new2)

# Patch 3: Add useEffect cleanup for advisory timers (placed after the
# auto-save useEffect, which is the only stable anchor in this section).
old3 = (
    f"{TAB}// Periodic auto-save every 60 seconds while a session is active\n"
    f"{TAB}useEffect(() => {{\n"
    f"{TAB}{TAB}const AUTO_SAVE_INTERVAL_MS = 60_000;\n"
    f"{TAB}{TAB}const timer = setInterval(() => {{\n"
    f"{TAB}{TAB}{TAB}const sid = sessionId;\n"
    f"{TAB}{TAB}{TAB}const ctx = ctxRef.current;\n"
    f"{TAB}{TAB}{TAB}if (sid && ctx) {{\n"
    f"{TAB}{TAB}{TAB}{TAB}sessionManager.saveSession(sid, ctx).catch((err: unknown) => {{\n"
    f"{TAB}{TAB}{TAB}{TAB}{TAB}debug.log(\"chat\", \"Periodic auto-save failed:\", err);\n"
    f"{TAB}{TAB}{TAB}{TAB}}});\n"
    f"{TAB}{TAB}{TAB}}}\n"
    f"{TAB}{TAB}}}, AUTO_SAVE_INTERVAL_MS);\n"
    f"{TAB}{TAB}return () => clearInterval(timer);\n"
    f"{TAB}}}, [sessionId]);"
)

new3 = (
    f"{TAB}// Periodic auto-save every 60 seconds while a session is active\n"
    f"{TAB}useEffect(() => {{\n"
    f"{TAB}{TAB}const AUTO_SAVE_INTERVAL_MS = 60_000;\n"
    f"{TAB}{TAB}const timer = setInterval(() => {{\n"
    f"{TAB}{TAB}{TAB}const sid = sessionId;\n"
    f"{TAB}{TAB}{TAB}const ctx = ctxRef.current;\n"
    f"{TAB}{TAB}{TAB}if (sid && ctx) {{\n"
    f"{TAB}{TAB}{TAB}{TAB}sessionManager.saveSession(sid, ctx).catch((err: unknown) => {{\n"
    f"{TAB}{TAB}{TAB}{TAB}{TAB}debug.log(\"chat\", \"Periodic auto-save failed:\", err);\n"
    f"{TAB}{TAB}{TAB}{TAB}}});\n"
    f"{TAB}{TAB}{TAB}}}\n"
    f"{TAB}{TAB}}}, AUTO_SAVE_INTERVAL_MS);\n"
    f"{TAB}{TAB}return () => clearInterval(timer);\n"
    f"{TAB}}}, [sessionId]);\n"
    f"\n"
    f"{TAB}// Cancel any pending advisory-dismiss timers on unmount. Without this,\n"
    f"{TAB}// a setTimeout fired after unmount would call setAdvisories on an\n"
    f"{TAB}// unmounted component (React warning, possible state inconsistency).\n"
    f"{TAB}useEffect(() => {{\n"
    f"{TAB}{TAB}return () => {{\n"
    f"{TAB}{TAB}{TAB}for (const timer of advisoryTimersRef.current) {{\n"
    f"{TAB}{TAB}{TAB}{TAB}clearTimeout(timer);\n"
    f"{TAB}{TAB}{TAB}}}\n"
    f"{TAB}{TAB}{TAB}advisoryTimersRef.current.clear();\n"
    f"{TAB}{TAB}}};\n"
    f"{TAB}}}, []);"
)

if old3 not in src:
    print("ERR: old3 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old3, new3)

# Patch 4: Add cache lookup + pruning to visibleMessages useMemo
old4 = (
    f"{TAB}const visibleMessages = useMemo(() => {{\n"
    f"{TAB}{TAB}const linesNeeded = chatViewportHeight + scrollOffset + 20;\n"
    f"{TAB}{TAB}const avgCharsPerLine = Math.max(20, contentMaxWidth - 4);\n"
    f"{TAB}{TAB}const estimateMsgLines = (msg: any) => {{"
)

new4 = (
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

if old4 not in src:
    print("ERR: old4 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old4, new4)

# Patch 5: Store estimate in cache (after the hasToolBlock check)
old5 = (
    f"{TAB}{TAB}{TAB}if (!hasToolBlock) {{\n"
    f"{TAB}{TAB}{TAB}{TAB}l += msg.toolCalls.length * 8;\n"
    f"{TAB}{TAB}{TAB}}}\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}return l + 1;"
)

new5 = (
    f"{TAB}{TAB}{TAB}if (!hasToolBlock) {{\n"
    f"{TAB}{TAB}{TAB}{TAB}l += msg.toolCalls.length * 8;\n"
    f"{TAB}{TAB}{TAB}}}\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}if (typeof msg.id === \"number\") {{\n"
    f"{TAB}{TAB}{TAB}cache.set(msg.id, l);\n"
    f"{TAB}{TAB}}}\n"
    f"{TAB}{TAB}return l + 1;"
)

if old5 not in src:
    print("ERR: old5 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old5, new5)

# Patch 6: Update useMemo deps to include the cache ref
old6 = (
    f"{TAB}{TAB}return messages.slice(Math.max(0, sliceIndex - 10));\n"
    f"{TAB}}}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth]);"
)

new6 = (
    f"{TAB}{TAB}return messages.slice(Math.max(0, sliceIndex - 10));\n"
    f"{TAB}}}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth, lineEstimateCacheRef]);"
)

if old6 not in src:
    print("ERR: old6 not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(old6, new6)

with open(path, "w") as f:
    f.write(src)

print("Patched OK (6 replacements)")
