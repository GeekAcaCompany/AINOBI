// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useRef, useSyncExternalStore, type RefObject } from "react";

/**
 * While playing, read the clock from playheadRef; with `clockRunning`, rAF drives subscribers to redraw.
 * While buffering/loading `readFromRef` stays true but the clock freezes on the ref, so it doesn't fall back to the lagging state.
 * While paused for editing, returns pausedTimeMs.
 */
export function usePlaybackPlayheadMs(
  readFromRef: boolean,
  clockRunning: boolean,
  pausedTimeMs: number,
  playheadRef: RefObject<number>,
): number {
  const pausedRef = useRef(pausedTimeMs);
  pausedRef.current = pausedTimeMs;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!clockRunning) return () => {};
      let raf = 0;
      const tick = (): void => {
        onStoreChange();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    },
    [clockRunning],
  );

  const getSnapshot = useCallback(
    () => (readFromRef ? playheadRef.current : pausedRef.current),
    [readFromRef, playheadRef],
  );

  const getServerSnapshot = useCallback(() => pausedRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
