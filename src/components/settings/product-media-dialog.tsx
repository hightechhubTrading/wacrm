'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { productMediaPublicUrl, type ProductFile } from './product-catalog-types';

export function ProductMediaDialog({
  file,
  productId,
  canEdit,
  onClose,
  onChanged,
}: {
  file: ProductFile;
  productId: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState(file.label ?? '');
  const [description, setDescription] = useState(file.ai_description ?? '');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLabel(file.label ?? '');
    setDescription(file.ai_description ?? '');
  }, [file.id]);

  const publicUrl = productMediaPublicUrl(file.storage_path);
  const busy = saving || regenerating || deleting;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), ai_description: description.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('File updated.');
        onChanged();
      } else {
        toast.error(data.error ?? 'Failed to update file.');
      }
    } catch {
      toast.error('Failed to update file.');
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${file.id}/regenerate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setDescription(data.ai_description ?? '');
        toast.success('Description regenerated.');
        onChanged();
      } else {
        toast.error(data.error ?? 'Could not regenerate description.');
      }
    } catch {
      toast.error('Could not regenerate description.');
    } finally {
      setRegenerating(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${file.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('File removed.');
        onChanged();
        onClose();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove file.');
      }
    } catch {
      toast.error('Failed to remove file.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{file.label || 'Untitled file'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {file.media_kind === 'image' ? (
            <img
              src={publicUrl}
              alt={file.label ?? ''}
              className="max-h-72 w-full rounded-md border border-border bg-muted/30 object-contain"
            />
          ) : (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-foreground hover:bg-accent"
            >
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              Open file in a new tab
            </a>
          )}

          <div className="space-y-2">
            <Label htmlFor="media-label">Label</Label>
            <Input
              id="media-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="front view"
              disabled={!canEdit || busy}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="media-description">AI description</Label>
              {file.media_kind === 'image' && canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void regenerate()}
                  disabled={busy}
                >
                  {regenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Regenerate
                </Button>
              )}
            </div>
            <Textarea
              id="media-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the AI agent reads to tell this file apart from the product's others."
              rows={3}
              disabled={!canEdit || busy}
            />
          </div>
        </div>

        {canEdit && (
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => void remove()}
              disabled={busy}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
