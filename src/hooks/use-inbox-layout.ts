'use client';

import { useEffect, useState } from 'react';

/** Measure the actual thread, including changes caused by the contact panel. */
export function useInboxLayout() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    if (!element) return;
    const roomyHeight = window.matchMedia('(min-height: 820px)');
    const measure = () => {
      const active = document.activeElement;
      const editing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      // Desktop WebKit can report a stale visualViewport during window resize.
      // Use it for a touch keyboard, where the visual viewport really is smaller.
      const keyboardHeight =
        navigator.maxTouchPoints > 0 && editing
          ? window.visualViewport?.height
          : undefined;
      setCompact(
        element.getBoundingClientRect().width < 1000 ||
          !roomyHeight.matches ||
          (keyboardHeight !== undefined && keyboardHeight < 820)
      );
    };
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    window.addEventListener('resize', scheduleMeasure);
    roomyHeight.addEventListener('change', scheduleMeasure);
    document.addEventListener('focusin', scheduleMeasure);
    document.addEventListener('focusout', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      roomyHeight.removeEventListener('change', scheduleMeasure);
      document.removeEventListener('focusin', scheduleMeasure);
      document.removeEventListener('focusout', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
    };
  }, [element]);
  return { ref, compact };
}
