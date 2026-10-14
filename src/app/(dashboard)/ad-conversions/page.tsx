"use client";
import { Megaphone } from 'lucide-react';
import { PageIdentity } from '@/components/workspace/page-identity';

import { useTranslations } from "next-intl";
import { RequireRole } from "@/components/auth/require-role";
import { AdConversionsReport } from "@/components/conversions/ad-conversions-report";

export default function AdConversionsPage() {
  const t = useTranslations("AdConversions");
  return (
    <div className="crm-page crm-ad-conversions-page space-y-6">
      <PageIdentity icon={Megaphone}>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </PageIdentity>
      <RequireRole min="admin" fallback={<p className="text-sm text-muted-foreground">{t("adminOnly")}</p>}>
        <AdConversionsReport />
      </RequireRole>
    </div>
  );
}
