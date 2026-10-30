'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { ThemeSync } from '@/components/theme-sync';
import '../workspace.css';
import '../design-system.css';
import '../inbox-workspace.css';
import { areaForPath } from '@/lib/ui-colors';
import { useTheme } from '@/hooks/use-theme';
import { LocaleSync } from '@/components/locale-sync';
import { CallingProvider } from '@/components/calling/calling-provider';
import { useTranslations } from 'next-intl';
import { MobileNavigation } from '@/components/layout/mobile-navigation';
import { useKeyboardViewport } from '@/hooks/use-keyboard-viewport';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Recovery');
  useKeyboardViewport();
  const { user, loading } = useAuth();
  const { mode } = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div role="status" className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div
      className="crm-workspace bg-background flex overflow-hidden"
      data-mode={mode}
      data-ui-area={areaForPath(pathname)}
    >
      <a
        href="#main-content"
        inert={sidebarOpen || undefined}
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-3"
      >
        {t('skipToContent')}
      </a>
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      {/* Pulls the saved accent/mode off the profile row on sign-in and
          back-fills it from this device when unset. Headless. */}
      <ThemeSync />
      {/* Same reconcile-on-login pattern, for the UI language. Headless. */}
      <LocaleSync />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      {/* inert while the mobile drawer is open — keeps keyboard/screen-reader
          focus from reaching content visually hidden behind the backdrop. */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        inert={sidebarOpen || undefined}
      >
        <Header
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main
          id="main-content"
          tabIndex={-1}
          data-area={pathname.split('/')[1]}
          className="crm-main min-w-0 flex-1 overflow-y-auto p-4 sm:p-6"
        >
          {children}
        </main>
        <MobileNavigation
          expanded={sidebarOpen}
          onMore={() => setSidebarOpen(true)}
        />
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CallingProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </CallingProvider>
    </AuthProvider>
  );
}
