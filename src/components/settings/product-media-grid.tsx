'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, FileText, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { ProductMediaDialog } from './product-media-dialog';
import { productMediaPublicUrl, type ProductFile } from './product-catalog-types';

const MAX_CONCURRENT_UPLOADS = 3;

interface PendingFile {
  localId: string;
  name: string;
  status: 'uploading' | 'describing' | 'error';
}

export function ProductMediaGrid({
  productId,
  files,
  canEdit,
  onChanged,
}: {
  productId: string;
  files: ProductFile[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setStatus = (localId: string, status: PendingFile['status']) => {
    setPending((p) => p.map((f) => (f.localId === localId ? { ...f, status } : f)));
  };

  const uploadOne = async (localId: string, file: File) => {
    const mediaKind = file.type.startsWith('image/') ? 'image' : 'document';
    let path: string | undefined;
    try {
      ({ path } = await uploadAccountMedia('ai-media', file));
      setStatus(localId, 'describing');
      const res = await fetch(`/api/ai/products/${productId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: '',
          storage_path: path,
          mime_type: file.type,
          media_kind: mediaKind,
          file_size: file.size,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Failed to save ${file.name}.`);
        await deleteAccountMedia('ai-media', path).catch(() => {});
        setStatus(localId, 'error');
        return;
      }
      setPending((p) => p.filter((f) => f.localId !== localId));
    } catch {
      toast.error(`Failed to upload ${file.name}.`);
      if (path) {
        await deleteAccountMedia('ai-media', path).catch(() => {});
      }
      setStatus(localId, 'error');
    }
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    if (!canEdit) return;
    const incoming = Array.from(fileList);
    const queue: { localId: string; file: File }[] = [];
    const nextPending: PendingFile[] = [];

    for (const file of incoming) {
      const mediaKind = file.type.startsWith('image/') ? 'image' : 'document';
      const maxBytes = MEDIA_MAX_BYTES_BY_KIND[mediaKind];
      if (file.size > maxBytes) {
        toast.error(
          `${file.name}: ${mediaKind === 'image' ? 'images must be 5 MB or smaller.' : 'documents must be 16 MB or smaller.'}`,
        );
        continue;
      }
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      queue.push({ localId, file });
      nextPending.push({ localId, name: file.name, status: 'uploading' });
    }
    if (queue.length === 0) return;

    setPending((p) => [...p, ...nextPending]);

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor];
        cursor += 1;
        await uploadOne(item.localId, item.file);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, queue.length) }, worker),
    );
    onChanged();
  };

  const openFile = files.find((f) => f.id === openFileId) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Photos & files</span>
        {canEdit && (
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent">
            <Upload className="h-3.5 w-3.5" />
            Select files
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>

      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!canEdit || !e.dataTransfer.files?.length) return;
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'grid grid-cols-2 gap-3 rounded-md border border-dashed p-3 sm:grid-cols-3 md:grid-cols-4',
          dragOver ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        {files.length === 0 && pending.length === 0 && (
          <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
            {canEdit ? 'Drop images here, or use "Select files".' : 'No files yet.'}
          </p>
        )}

        {files.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setOpenFileId(f.id)}
            className="group flex flex-col overflow-hidden rounded-md border border-border text-start hover:border-primary/50"
          >
            <span className="flex aspect-square items-center justify-center bg-muted/30">
              {f.media_kind === 'image' ? (
                <img
                  src={productMediaPublicUrl(f.storage_path)}
                  alt={f.label ?? ''}
                  className="h-full w-full object-cover"
                />
              ) : (
                <FileText className="h-8 w-8 text-muted-foreground" />
              )}
            </span>
            <span className="truncate px-2 py-1.5 text-xs text-foreground">
              {f.label || (f.ai_description ? f.ai_description.slice(0, 40) : '(untitled)')}
            </span>
          </button>
        ))}

        {pending.map((p) => (
          <div
            key={p.localId}
            className={cn(
              'flex flex-col overflow-hidden rounded-md border border-dashed',
              p.status === 'error'
                ? 'border-destructive bg-destructive/5'
                : 'border-border',
            )}
          >
            <span
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1.5',
                p.status === 'error'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-muted/30 text-muted-foreground',
              )}
            >
              {p.status === 'error' ? (
                <AlertCircle className="h-5 w-5" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin" />
              )}
              <span className="text-[10px]">
                {p.status === 'uploading'
                  ? 'Uploading…'
                  : p.status === 'describing'
                    ? 'Describing…'
                    : 'Failed'}
              </span>
            </span>
            <span
              className={cn(
                'truncate px-2 py-1.5 text-xs',
                p.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {p.name}
            </span>
          </div>
        ))}
      </div>

      {openFile && (
        <ProductMediaDialog
          file={openFile}
          productId={productId}
          canEdit={canEdit}
          onClose={() => setOpenFileId(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
