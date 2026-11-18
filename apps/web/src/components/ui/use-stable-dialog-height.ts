import { useEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
// Preserve footprint and keyed keyboard focus across protected-content rechecks.
// Only UI identifiers are retained, never record values or hidden authorization.
export function useStableDialogHeight(active: boolean, retainLargest = true) {
  const [element, setElement] = useState<HTMLDivElement | null>(null),
    [height, setHeight] = useState(0),
    lastFocus = useRef<{ id: string; key: string } | null>(null),
    restore = useRef(false);
  useEffect(() => {
    if (!element || !active) return;
    const observer = new ResizeObserver(() =>
      setHeight((previous) =>
        retainLargest
          ? Math.max(
              previous,
              Math.ceil(element.getBoundingClientRect().height),
            )
          : Math.ceil(element.getBoundingClientRect().height),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, active, retainLargest]);
  useEffect(() => {
    if (!active) {
      restore.current = true;
      return;
    }
    if (!restore.current || !element || !lastFocus.current) return;
    const target = lastFocus.current.id
      ? document.getElementById(lastFocus.current.id)
      : lastFocus.current.key
        ? element.querySelector<HTMLElement>(
            `[data-focus-key="${CSS.escape(lastFocus.current.key)}"]`,
          )
        : null;
    if (
      target &&
      element.contains(target) &&
      !(target instanceof HTMLButtonElement && target.disabled)
    ) {
      target.focus();
      restore.current = false;
    }
  });
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (active && event.target instanceof HTMLElement)
      lastFocus.current = {
        id: event.target.id,
        key: event.target.dataset.focusKey ?? '',
      };
  };
  return {
    ref: setElement,
    onFocusCapture,
    style:
      height && (retainLargest || !active)
        ? { minHeight: `min(${height}px, calc(100dvh - 2rem))` }
        : undefined,
  };
}
