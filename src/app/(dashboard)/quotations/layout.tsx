import type { ReactNode } from 'react';
import { RouteMessages } from '@/i18n/route-messages';

export default function Layout({ children }: { children: ReactNode }) {
  return <RouteMessages route="quotations">{children}</RouteMessages>;
}
