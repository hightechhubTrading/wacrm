'use client';

import { CustomFieldGroupsPanel } from '@/components/settings/custom-field-groups-panel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';

interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog wrapper around {@link CustomFieldGroupsPanel}, used on the
 * Contacts page. The same panel is rendered inline under Settings →
 * Fields & tags, so the editing UI lives in one place. Radix unmounts
 * the dialog content on close, so the panel remounts (and refetches)
 * on each open. Owner-gated by the caller (`useCan("manage-field-groups")`).
 */
export function CustomFieldsManager({
  open,
  onOpenChange,
}: CustomFieldsManagerProps) {
  const t = useTranslations('CustomFieldGroups.panel');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('dialogTitle')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('dialogDesc')}
          </DialogDescription>
        </DialogHeader>
        <CustomFieldGroupsPanel />
      </DialogContent>
    </Dialog>
  );
}
