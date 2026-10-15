'use client';

import Link from 'next/link';
import { UserPlus, Briefcase, Radio, Zap, ArrowUpRight } from 'lucide-react';
import type { ComponentType } from 'react';

import { useTranslations } from 'next-intl';

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tint: string;
}

const ACTIONS: Action[] = [
  {
    labelKey: 'newContact',
    href: '/contacts',
    icon: UserPlus,
    tint: 'text-primary',
  },
  {
    labelKey: 'newDeal',
    href: '/pipelines',
    icon: Briefcase,
    tint: 'text-muted-foreground',
  },
  {
    labelKey: 'newBroadcast',
    href: '/broadcasts/new',
    icon: Radio,
    tint: 'text-muted-foreground',
  },
  {
    labelKey: 'newAutomation',
    href: '/automations/new',
    icon: Zap,
    tint: 'text-primary',
  },
];

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions');

  return (
    <nav aria-label={t('title')} className="crm-quick-actions">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="crm-quick-action group bg-card hover:bg-muted/60 flex items-center gap-3 transition-colors"
          >
            <div
              className={`crm-action-symbol flex h-5 w-5 items-center justify-center ${a.tint}`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-foreground text-sm font-medium">
              {t(a.labelKey as string)}
            </span>
            <ArrowUpRight
              className="crm-action-arrow rtl:-scale-x-100"
              aria-hidden="true"
            />
          </Link>
        );
      })}
    </nav>
  );
}
