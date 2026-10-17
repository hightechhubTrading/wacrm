'use client';

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from 'react';
import { ContactSidebar } from './contact-sidebar';

const desktopQuery = '(min-width: 1024px)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const isDesktop = () => window.matchMedia(desktopQuery).matches;

/** Reserve the panel's space, but let messages paint before starting its reads. */
export function DeferredContactPanel({
  ready,
  ...props
}: ComponentProps<typeof ContactSidebar> & { ready: boolean }) {
  const desktop = useSyncExternalStore(subscribe, isDesktop, () => false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!ready || !desktop) return;
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(() => setMounted(true), {
        timeout: 500,
      });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, [ready, desktop]);
  return (
    <div className="crm-details-pane hidden lg:block" aria-busy={!mounted}>
      {mounted && desktop ? (
        <ContactSidebar {...props} />
      ) : (
        <div aria-hidden className="space-y-4 p-5">
          <div className="bg-muted h-5 w-28 rounded" />
          <div className="bg-muted h-24 rounded-xl" />
        </div>
      )}
    </div>
  );
}
