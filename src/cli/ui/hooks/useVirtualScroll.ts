import { useState, useCallback, useEffect } from 'react';

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
  const [selectedIndex, setSelectedIndex] = useState(() =>
    Math.min(Math.max(0, initialSelectedIndex), Math.max(0, totalItems - 1))
  );

  const [windowStart, setWindowStart] = useState(() => {
    const start = Math.max(0, selectedIndex - Math.floor(maxVisibleWindow / 2));
    return Math.min(start, Math.max(0, totalItems - maxVisibleWindow));
  });

  // Keep state valid if totalItems changes
  useEffect(() => {
    if (totalItems === 0) {
      setSelectedIndex(0);
      setWindowStart(0);
      return;
    }

    setSelectedIndex((prev) => {
      const clamped = Math.min(prev, totalItems - 1);
      return Math.max(0, clamped);
    });

    setWindowStart((prev) => {
      // If the current window start is beyond what's possible, bring it back
      const maxPossibleStart = Math.max(0, totalItems - maxVisibleWindow);
      return Math.min(prev, maxPossibleStart);
    });
  }, [totalItems, maxVisibleWindow]);

  const windowEnd = Math.min(windowStart + maxVisibleWindow, totalItems);

  const moveUp = useCallback(() => {
    if (totalItems === 0) return;
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
  }, [totalItems]);

  const moveDown = useCallback(() => {
    if (totalItems === 0) return;
    setSelectedIndex((prevIndex) => {
      const newIndex = Math.min(totalItems - 1, prevIndex + 1);

      setWindowStart((prevStart) => {
        if (newIndex >= prevStart + maxVisibleWindow) {
          return Math.max(0, newIndex - maxVisibleWindow + 1);
        }
        return prevStart;
      });

      return newIndex;
    });
  }, [totalItems, maxVisibleWindow]);

  const getVisibleItems = useCallback(
    <T>(items: T[]): T[] => {
      return items.slice(windowStart, windowEnd);
    },
    [windowStart, windowEnd]
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
