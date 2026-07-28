'use client';

import { Shield, SlidersHorizontal } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { CustomFieldGroupsPanel } from './custom-field-groups-panel';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom
 * field GROUP catalogue (migration 046) — the same panel the Contacts
 * page exposes via a dialog. Owner-only (tightened from admin+, see
 * `canManageFieldGroups`): group/field schema now governs pipeline
 * gating, not just contact metadata. Enforced by the caller's
 * `useCan("manage-field-groups")` gate and by owner-tier RLS.
 */
export function CustomFieldsSettings() {
  const t = useTranslations('Settings.tagsAndFields');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <SlidersHorizontal className="size-4 text-primary" />
          {t('fieldsTitle')}
          <SettingsChip variant="owner" className="font-medium">
            <Shield />
            {t('ownerRole')}
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('fieldsDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CustomFieldGroupsPanel />
      </CardContent>
    </Card>
  );
}
