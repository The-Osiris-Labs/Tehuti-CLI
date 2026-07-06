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
	const safeTotalItems = Math.max(0, Number.isNaN(totalItems) ? 0 : Number(totalItems));
	const safeMaxWindow = Math.max(1, Number.isNaN(maxVisibleWindow) ? 15 : Number(maxVisibleWindow));

	const [selectedIndex, setSelectedIndex] = useState(() =>
		safeTotalItems === 0 ? 0 : Math.min(Math.max(0, initialSelectedIndex), Math.max(0, safeTotalItems - 1)),
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

	const getVisibleItems = useCallback(
		<T>(items: T[]): T[] => {
			return items.slice(windowStart, windowEnd);
		},
		[windowStart, windowEnd],
	);

	return {
		selectedIndex,
		windowStart,
		windowEnd,
		visibleSelectedIndex: Math.max(0, selectedIndex - windowStart),
		moveUp,
		moveDown,
		getVisibleItems,
		setSelectedIndex,
	};
}
