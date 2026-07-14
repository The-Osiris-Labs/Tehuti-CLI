import { Text } from "ink";
import { render } from "ink-testing-library";
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import {
	type UseChatViewportOptions,
	type UseChatViewportReturn,
	useChatViewport,
} from "../ui/hooks/useChatViewport.js";

type Message = { id: number; role: "user"; content: string };

const waitForViewport = () =>
	new Promise<void>((resolve) => {
		// Ink's test renderer schedules updates asynchronously.
		setTimeout(resolve, 25);
	});

function messages(count: number, content = "message"): Message[] {
	return Array.from({ length: count }, (_, id) => ({
		id,
		role: "user" as const,
		content,
	}));
}

function ViewportProbe({
	messages: nextMessages,
	capture,
	overrides,
}: {
	messages: Message[];
	capture: { current?: UseChatViewportReturn };
	overrides?: Partial<UseChatViewportOptions>;
}) {
	const [scrollOffset, setScrollOffset] = useState(0);
	const viewport = useChatViewport({
		messages: nextMessages,
		terminalHeight: 30,
		terminalWidth: 80,
		headerHeight: 3,
		promptOverlayHeight: 4,
		warningsHeight: 0,
		paletteHeight: 0,
		loadingOverlayHeight: 0,
		thinkingOverlayHeight: 0,
		errorOverlayHeight: 0,
		input: "",
		showWelcome: false,
		scrollOffset,
		setScrollOffset,
		...overrides,
	});

	capture.current = viewport;

	return React.createElement(
		Text,
		null,
		`${viewport.scrollOffset}:${viewport.chatViewportHeight}:${viewport.newMessageCount}`,
	);
}

function probe(
	nextMessages: Message[],
	overrides?: Partial<UseChatViewportOptions>,
) {
	const capture: { current?: UseChatViewportReturn } = {};
	const tree = (currentMessages: Message[]) =>
		React.createElement(ViewportProbe, {
			messages: currentMessages,
			capture,
			overrides,
		});
	const instance = render(tree(nextMessages));
	return { capture, instance, tree };
}

describe("useChatViewport", () => {
	it("navigates line, page, top, and bottom using the latest external offset", async () => {
		const harness = probe(messages(80));
		await waitForViewport();

		harness.capture.current?.scrollLineUp();
		harness.capture.current?.scrollLineUp();
		await waitForViewport();
		expect(harness.capture.current?.scrollOffset).toBe(2);

		const viewportHeight = harness.capture.current?.chatViewportHeight ?? 0;
		harness.capture.current?.scrollPageUp();
		await waitForViewport();
		expect(harness.capture.current?.scrollOffset).toBe(2 + viewportHeight);

		harness.capture.current?.scrollToTop();
		await waitForViewport();
		const topOffset = harness.capture.current?.scrollOffset ?? 0;
		expect(topOffset).toBeGreaterThan(2 + viewportHeight);

		harness.capture.current?.scrollToBottom();
		await waitForViewport();
		expect(harness.capture.current?.scrollOffset).toBe(0);
		expect(harness.capture.current?.isAtBottom).toBe(true);
		harness.instance.unmount();
	});

	it("keeps a valid scroll offset when content shrinks", async () => {
		const harness = probe(messages(80, "a long enough message to create a useful scroll range"));
		await waitForViewport();
		harness.capture.current?.scrollToTop();
		await waitForViewport();
		const beforeResize = harness.capture.current?.scrollOffset ?? 0;

		harness.instance.rerender(harness.tree(messages(1)));
		await waitForViewport();
		const afterResize = harness.capture.current?.scrollOffset ?? 0;
		expect(afterResize).toBeGreaterThanOrEqual(0);
		expect(afterResize).toBeLessThan(beforeResize);
		harness.instance.unmount();
	});

	it("accounts for the input, loading, and thinking overlays without using scroll state", async () => {
		const base = probe(messages(80));
		const overlays = probe(messages(80), {
			promptOverlayHeight: 6,
			loadingOverlayHeight: 5,
			thinkingOverlayHeight: 2,
		});
		await waitForViewport();

		expect(overlays.capture.current?.chatViewportHeight).toBe(
			(base.capture.current?.chatViewportHeight ?? 0) - 9,
		);
		base.instance.unmount();
		overlays.instance.unmount();
	});

	it("does not change viewport height when the scroll badge becomes visible", async () => {
		const harness = probe(messages(80));
		await waitForViewport();
		const bottomHeight = harness.capture.current?.chatViewportHeight;

		harness.capture.current?.scrollLineUp();
		await waitForViewport();
		expect(harness.capture.current?.chatViewportHeight).toBe(bottomHeight);
		harness.instance.unmount();
	});

	it("keeps an intentional upward scroll and counts later messages", async () => {
		const initialMessages = messages(80);
		const harness = probe(initialMessages);
		await waitForViewport();

		harness.capture.current?.scrollLineUp();
		await waitForViewport();
		const intentionalOffset = harness.capture.current?.scrollOffset;

		harness.instance.rerender(
			harness.tree([
				...initialMessages,
				{ id: 80, role: "user", content: "new arrival" },
			]),
		);
		await waitForViewport();
		expect(harness.capture.current?.scrollOffset).toBe(intentionalOffset);
		expect(harness.capture.current?.newMessageCount).toBe(1);
		expect(harness.capture.current?.isAtBottom).toBe(false);
		harness.instance.unmount();
	});

	it("clears the new-message badge when scrolling back to the bottom", async () => {
		const initialMessages = messages(80);
		const harness = probe(initialMessages);
		await waitForViewport();
		harness.capture.current?.scrollLineUp();
		await waitForViewport();

		harness.instance.rerender(
			harness.tree([
				...initialMessages,
				{ id: 80, role: "user", content: "new arrival" },
			]),
		);
		await waitForViewport();
		expect(harness.capture.current?.newMessageCount).toBe(1);

		harness.capture.current?.scrollToBottom();
		await waitForViewport();
		expect(harness.capture.current?.scrollOffset).toBe(0);
		expect(harness.capture.current?.newMessageCount).toBe(0);
		expect(harness.capture.current?.isAtBottom).toBe(true);
		harness.instance.unmount();
	});
});
