'use client';
import { useEffect } from 'react';

/** Use the visible height for a keyboard, while leaving pinch zoom to the browser. */
export function useKeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = document.activeElement;
        const editing =
          target instanceof HTMLElement &&
          (target.matches('input,textarea') || target.isContentEditable);
        if (
          editing &&
          viewport.scale === 1 &&
          viewport.height < window.innerHeight - 80
        )
          document.documentElement.style.setProperty(
            '--crm-viewport-height',
            `${Math.round(viewport.height)}px`
          );
        else
          document.documentElement.style.removeProperty(
            '--crm-viewport-height'
          );
      });
    };
    viewport.addEventListener('resize', sync);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', sync);
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
      document.documentElement.style.removeProperty('--crm-viewport-height');
    };
  }, []);
}
