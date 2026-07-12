import { useCallback, useEffect, useState } from "react";

export type VirtualScrollMode = "cursor" | "tailFollow";

export interface UseVirtualScrollOptions {
	totalItems: number;
	maxVisibleWindow?: number;
	initialSelectedIndex?: number;
	/**
	 * Behavior mode:
	 * - "cursor" (default): a selected index is tracked and visible.
	 *   Good for menus, command palettes, session lists.
	 * - "tailFollow": the window auto-anchors to the last `maxVisibleWindow`
	 *   items when `tailFollowActive` is true. User scroll up breaks the
	 *   anchor; explicit `scrollToEnd` re-anchors. Good for log streams,
	 *   chat-style viewports where new items arrive at the tail.
	 */
	mode?: VirtualScrollMode;
}

export function useVirtualScroll({
	totalItems,
	maxVisibleWindow = 15,
	initialSelectedIndex = 0,
	mode = "cursor",
}: UseVirtualScrollOptions) {
	const safeTotalItems = Math.max(
		0,
		Number.isNaN(totalItems) ? 0 : Number(totalItems),
	);
	const safeMaxWindow = Math.max(
		1,
		Number.isNaN(maxVisibleWindow) ? 15 : Number(maxVisibleWindow),
	);

	const isTailFollow = mode === "tailFollow";

	const [selectedIndex, setSelectedIndex] = useState(() =>
		safeTotalItems === 0
			? 0
			: Math.min(
					Math.max(0, initialSelectedIndex),
					Math.max(0, safeTotalItems - 1),
				),
	);

	const [tailFollowActive, setTailFollowActive] = useState(isTailFollow);

	const [windowStart, setWindowStart] = useState(() => {
		if (safeTotalItems === 0) return 0;
		if (isTailFollow && tailFollowActive) {
			return Math.max(0, safeTotalItems - safeMaxWindow);
		}
		const start = Math.max(0, selectedIndex - Math.floor(safeMaxWindow / 2));
		return Math.min(start, Math.max(0, safeTotalItems - safeMaxWindow));
	});

	// Keep state valid if totalItems changes
	useEffect(() => {
		if (safeTotalItems === 0) {
			setSelectedIndex(0);
			setWindowStart(0);
			return;
		}

		setSelectedIndex((prev) => {
			const clamped = Math.min(prev, safeTotalItems - 1);
			return Math.max(0, clamped);
		});

		setWindowStart((prev) => {
			// In tail-follow mode: if active, snap to end; otherwise just clamp
			if (isTailFollow && tailFollowActive) {
				return Math.max(0, safeTotalItems - safeMaxWindow);
			}
			const maxPossibleStart = Math.max(0, safeTotalItems - safeMaxWindow);
			return Math.min(prev, maxPossibleStart);
		});
	}, [safeTotalItems, safeMaxWindow, isTailFollow, tailFollowActive]);

	const windowEnd = Math.min(windowStart + safeMaxWindow, safeTotalItems);

	const moveUp = useCallback(() => {
		if (safeTotalItems === 0) return;
		setSelectedIndex((prevIndex) => {
			const newIndex = Math.max(0, prevIndex - 1);

			setWindowStart((prevStart) => {
				if (newIndex < prevStart) {
					return newIndex;
				}
				return prevStart;
			});

			return newIndex;
		});
	}, [safeTotalItems]);

	const moveDown = useCallback(() => {
		if (safeTotalItems === 0) return;
		setSelectedIndex((prevIndex) => {
			const newIndex = Math.min(safeTotalItems - 1, prevIndex + 1);

			setWindowStart((prevStart) => {
				if (newIndex >= prevStart + safeMaxWindow) {
					return Math.max(0, newIndex - safeMaxWindow + 1);
				}
				return prevStart;
			});

			return newIndex;
		});
	}, [safeTotalItems, safeMaxWindow]);

	const movePageUp = useCallback(() => {
		if (safeTotalItems === 0) return;
		setSelectedIndex((prevIndex) => {
			const newIndex = Math.max(0, prevIndex - safeMaxWindow);

			setWindowStart((prevStart) => {
				// Scroll the window by one page, but never past 0
				return Math.max(0, prevStart - safeMaxWindow);
			});

			return newIndex;
		});
	}, [safeTotalItems, safeMaxWindow]);

	const movePageDown = useCallback(() => {
		if (safeTotalItems === 0) return;
		setSelectedIndex((prevIndex) => {
			const newIndex = Math.min(safeTotalItems - 1, prevIndex + safeMaxWindow);

			setWindowStart((prevStart) => {
				// Scroll the window by one page, but never past the last valid start
				const maxStart = Math.max(0, safeTotalItems - safeMaxWindow);
				return Math.min(maxStart, prevStart + safeMaxWindow);
			});

			return newIndex;
		});
	}, [safeTotalItems, safeMaxWindow]);

	const moveToStart = useCallback(() => {
		if (safeTotalItems === 0) return;
		setSelectedIndex(0);
		setWindowStart(0);
	}, [safeTotalItems]);

	const moveToEnd = useCallback(() => {
		if (safeTotalItems === 0) return;
		const lastIndex = safeTotalItems - 1;
		setSelectedIndex(lastIndex);
		setWindowStart(Math.max(0, safeTotalItems - safeMaxWindow));
	}, [safeTotalItems, safeMaxWindow]);

	const getVisibleItems = useCallback(
		<T>(items: T[]): T[] => {
			return items.slice(windowStart, windowEnd);
		},
		[windowStart, windowEnd],
	);

	const scrollUp = useCallback(() => {
		if (isTailFollow && tailFollowActive) {
			setTailFollowActive(false);
		}
		setWindowStart((prev) => Math.max(0, prev - 1));
	}, [isTailFollow, tailFollowActive]);

	const scrollDown = useCallback(() => {
		const maxStart = Math.max(0, safeTotalItems - safeMaxWindow);
		setWindowStart((prev) => {
			const newStart = Math.min(maxStart, prev + 1);
			if (isTailFollow && newStart >= maxStart && !tailFollowActive) {
				setTailFollowActive(true);
			}
			return newStart;
		});
	}, [safeTotalItems, safeMaxWindow, isTailFollow, tailFollowActive]);

	const scrollPageUp = useCallback(() => {
		if (isTailFollow && tailFollowActive) {
			setTailFollowActive(false);
		}
		setWindowStart((prev) => Math.max(0, prev - safeMaxWindow));
	}, [safeMaxWindow, isTailFollow, tailFollowActive]);

	const scrollPageDown = useCallback(() => {
		const maxStart = Math.max(0, safeTotalItems - safeMaxWindow);
		setWindowStart((prev) => {
			const newStart = Math.min(maxStart, prev + safeMaxWindow);
			if (isTailFollow && newStart >= maxStart && !tailFollowActive) {
				setTailFollowActive(true);
			}
			return newStart;
		});
	}, [safeTotalItems, safeMaxWindow, isTailFollow, tailFollowActive]);

	const scrollToEnd = useCallback(() => {
		if (safeTotalItems === 0) return;
		const lastStart = Math.max(0, safeTotalItems - safeMaxWindow);
		setWindowStart(lastStart);
		if (isTailFollow) {
			setTailFollowActive(true);
		}
	}, [safeTotalItems, safeMaxWindow, isTailFollow]);

	return {
		selectedIndex,
		windowStart,
		windowEnd,
		visibleSelectedIndex: Math.max(0, selectedIndex - windowStart),
		tailFollowActive: isTailFollow ? tailFollowActive : undefined,
		setTailFollowActive: isTailFollow ? setTailFollowActive : undefined,
		scrollToEnd: isTailFollow ? scrollToEnd : undefined,
		moveUp,
		moveDown,
		movePageUp,
		movePageDown,
		scrollUp,
		scrollDown,
		scrollPageUp,
		scrollPageDown,
		moveToStart,
		moveToEnd,
		getVisibleItems,
		setSelectedIndex,
	};
}
