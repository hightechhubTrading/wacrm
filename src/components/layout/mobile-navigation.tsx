'use client';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, MessageSquare, Menu } from 'lucide-react';
import { IntentLink } from './intent-link';
import { cn } from '@/lib/utils';

export function MobileNavigation({
  onMore,
  expanded,
}: {
  onMore: () => void;
  expanded: boolean;
}) {
  const pathname = usePathname(),
    t = useTranslations('Sidebar');
  return (
    <nav
      aria-label={t('mobileNavigation')}
      className="crm-mobile-nav border-border bg-background grid shrink-0 grid-cols-3 border-t lg:hidden"
    >
      {[
        { href: '/dashboard', label: t('today'), icon: LayoutDashboard },
        { href: '/inbox', label: t('inbox'), icon: MessageSquare },
      ].map((item) => (
        <IntentLink
          key={item.href}
          href={item.href}
          aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
          className={cn(
            'flex min-h-14 flex-col items-center justify-center gap-1 rounded-sm px-3 py-2 text-xs font-medium focus-visible:outline-2',
            pathname.startsWith(item.href)
              ? 'text-primary'
              : 'text-muted-foreground'
          )}
        >
          <item.icon className="size-5" aria-hidden="true" />
          {item.label}
        </IntentLink>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-expanded={expanded}
        aria-controls="primary-sidebar"
        className="text-muted-foreground flex min-h-14 flex-col items-center justify-center gap-1 rounded-sm px-3 py-2 text-xs font-medium focus-visible:outline-2"
      >
        <Menu className="size-5" aria-hidden="true" />
        {t('more')}
      </button>
    </nav>
  );
}
