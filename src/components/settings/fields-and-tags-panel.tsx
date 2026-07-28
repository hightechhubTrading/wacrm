'use client';

import { useCan } from '@/hooks/use-can';

import { useTranslations } from 'next-intl';

import { CustomFieldsSettings } from './custom-fields-settings';
import { SettingsPanelHead } from './settings-panel-head';
import { TagManager } from './tag-manager';

/**
 * "Fields & tags" section — merges the former Tags and Custom Fields
 * tabs. Tags are visible to everyone; the custom field GROUP catalogue
 * (migration 046) now governs pipeline gating, so the card is
 * owner-gated (tightened from admin+ — see `canManageFieldGroups`).
 * `custom_field_groups`/`custom_fields` RLS rejects non-owner writes
 * regardless.
 */
export function FieldsAndTagsPanel() {
  const t = useTranslations('Settings.tagsAndFields');
  const canManageFieldGroups = useCan('manage-field-groups');

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />
      <TagManager />
      {canManageFieldGroups ? <CustomFieldsSettings /> : null}
    </section>
  );
}
