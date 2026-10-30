'use client';
import { Settings2 } from 'lucide-react';
import { PageIdentity } from '@/components/workspace/page-identity';

import { Suspense, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

function PanelLoading() {
  return (
    <div
      className="bg-muted min-h-64 animate-pulse rounded-xl"
      aria-busy="true"
    />
  );
}

const ProfileForm = dynamic(
  () => import('@/components/settings/profile-form').then((m) => m.ProfileForm),
  { loading: PanelLoading }
);
const SecurityPanel = dynamic(
  () =>
    import('@/components/settings/security-panel').then((m) => m.SecurityPanel),
  { loading: PanelLoading }
);
const AppearancePanel = dynamic(
  () =>
    import('@/components/settings/appearance-panel').then(
      (m) => m.AppearancePanel
    ),
  { loading: PanelLoading }
);
const WhatsAppConfig = dynamic(
  () =>
    import('@/components/settings/whatsapp-config').then(
      (m) => m.WhatsAppConfig
    ),
  { loading: PanelLoading }
);
const TemplateManager = dynamic(
  () =>
    import('@/components/settings/template-manager').then(
      (m) => m.TemplateManager
    ),
  { loading: PanelLoading }
);
const QuickRepliesManager = dynamic(
  () =>
    import('@/components/settings/quick-replies-manager').then(
      (m) => m.QuickRepliesManager
    ),
  { loading: PanelLoading }
);
const FieldsAndTagsPanel = dynamic(
  () =>
    import('@/components/settings/fields-and-tags-panel').then(
      (m) => m.FieldsAndTagsPanel
    ),
  { loading: PanelLoading }
);
const DealsSettings = dynamic(
  () =>
    import('@/components/settings/deals-settings').then((m) => m.DealsSettings),
  { loading: PanelLoading }
);
const ProductCatalogPanel = dynamic(
  () =>
    import('@/components/settings/product-catalog-panel').then(
      (m) => m.ProductCatalogPanel
    ),
  { loading: PanelLoading }
);
const MembersTab = dynamic(
  () => import('@/components/settings/members-tab').then((m) => m.MembersTab),
  { loading: PanelLoading }
);
const ApiKeysSettings = dynamic(
  () =>
    import('@/components/settings/api-keys-settings').then(
      (m) => m.ApiKeysSettings
    ),
  { loading: PanelLoading }
);
const QuotationProductCodes = dynamic(
  () =>
    import('@/components/settings/quotation-product-codes').then(
      (m) => m.QuotationProductCodes
    ),
  { loading: PanelLoading }
);

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering — shipping a settings screen whose rail never
// wires up its click handlers. You land on the section the URL carried
// (the account-menu Settings link points at `?tab=whatsapp`) and can't
// navigate away. Mirror the login/signup split: a thin wrapper supplies
// the boundary; the inner component reads the query string.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('Settings');

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    products: <ProductCatalogPanel />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
    'quotation-product-codes': <QuotationProductCodes />,
  };

  return (
    <div className="crm-page crm-settings-page">
      <PageIdentity icon={Settings2}>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          {t('pageTitle')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('pageDesc')}</p>
      </PageIdentity>

      <div className="mt-8 grid gap-8 lg:grid-cols-[216px_minmax(0,1fr)] lg:items-start lg:gap-12">
        <SettingsRail active={section} onSelect={go} />
        <div className="crm-settings-content min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
