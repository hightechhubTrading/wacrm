'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';

/** Prefetch likely navigation without loading every visible CRM section. */
export function IntentLink({
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel]);
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onMouseEnter={(event) => {
        cancel();
        timer.current = setTimeout(() => setIntent(true), 150);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        cancel();
        setIntent(false);
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        cancel();
        setIntent(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        cancel();
        setIntent(false);
        onBlur?.(event);
      }}
    />
  );
}
