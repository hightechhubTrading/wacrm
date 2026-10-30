'use client';

import { RecoveryPanel } from '@/components/workspace/recovery-panel';

export default function ErrorPage({
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  return (
    <RecoveryPanel
      retry={unstable_retry ?? reset ?? (() => window.location.reload())}
    />
  );
}
