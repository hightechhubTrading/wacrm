'use client';

import { useEffect, useState } from 'react';

/** Measure the actual thread, including changes caused by the contact panel. */
export function useInboxLayout() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const height = Math.min(
        window.innerHeight,
        window.visualViewport?.height ?? window.innerHeight
      );
      setCompact(element.clientWidth < 1000 || height < 820);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [element]);
  return { ref, compact };
}
