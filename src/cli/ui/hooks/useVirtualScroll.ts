import { useCallback, useEffect, useState } from "react";

export interface UseVirtualScrollOptions {
	totalItems: number;
	maxVisibleWindow?: number;
	initialSelectedIndex?: number;
}

export function useVirtualScroll({
	totalItems,
	maxVisibleWindow = 15,
	initialSelectedIndex = 0,
}: UseVirtualScrollOptions) {
	const safeTotalItems = Math.max(
		0,
		Number.isNaN(totalItems) ? 0 : Number(totalItems),
	);
	const safeMaxWindow = Math.max(
		1,
		Number.isNaN(maxVisibleWindow) ? 15 : Number(maxVisibleWindow),
	);

	const [selectedIndex, setSelectedIndex] = useState(() =>
		safeTotalItems === 0
			? 0
			: Math.min(
					Math.max(0, initialSelectedIndex),
					Math.max(0, safeTotalItems - 1),
				),
	);

	const [windowStart, setWindowStart] = useState(() => {
		if (safeTotalItems === 0) return 0;
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
			// If the current window start is beyond what's possible, bring it back
			const maxPossibleStart = Math.max(0, safeTotalItems - safeMaxWindow);
			return Math.min(prev, maxPossibleStart);
		});
	}, [safeTotalItems, safeMaxWindow]);

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
		setWindowStart((prev) => Math.max(0, prev - 1));
	}, []);

	const scrollDown = useCallback(() => {
		const maxStart = Math.max(0, safeTotalItems - safeMaxWindow);
		setWindowStart((prev) => Math.min(maxStart, prev + 1));
	}, [safeTotalItems, safeMaxWindow]);

	const scrollPageUp = useCallback(() => {
		setWindowStart((prev) => Math.max(0, prev - safeMaxWindow));
	}, [safeMaxWindow]);

	const scrollPageDown = useCallback(() => {
		const maxStart = Math.max(0, safeTotalItems - safeMaxWindow);
		setWindowStart((prev) => Math.min(maxStart, prev + safeMaxWindow));
	}, [safeTotalItems, safeMaxWindow]);

	return {
		selectedIndex,
		windowStart,
		windowEnd,
		visibleSelectedIndex: Math.max(0, selectedIndex - windowStart),
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
