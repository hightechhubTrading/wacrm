'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  REFERENCE_IMAGE_MAX_BYTES,
  validReferenceImage,
  type QuotationReferenceImage,
} from '@/lib/quotations/reference-image';

export function QuotationReferenceImage({
  quotationId,
  image,
  disabled,
  onChange,
  onUploadingChange,
}: {
  quotationId: string;
  image?: QuotationReferenceImage;
  disabled: boolean;
  onChange: (image: QuotationReferenceImage | undefined) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations('QuotationWorkspace');
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<XMLHttpRequest | null>(null);
  const lastFile = useRef<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    []
  );
  const uploading = progress !== null;
  function upload(file: File) {
    if (disabled || active.current) return;
    lastFile.current = file;
    setError(null);
    if (!file.size || file.size > REFERENCE_IMAGE_MAX_BYTES) {
      setError('referenceImageSize');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('referenceImageInvalid');
      return;
    }
    const xhr = new XMLHttpRequest();
    active.current = xhr;
    setProgress(0);
    onUploadingChange(true);
    xhr.open('POST', `/api/quotations/${quotationId}/image`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.timeout = 90_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100))
        );
    };
    const finish = () => {
      active.current = null;
      setProgress(null);
      onUploadingChange(false);
    };
    xhr.onload = () => {
      let result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        /* Report a retryable failure below. */
      }
      if (xhr.status === 201 && validReferenceImage(result?.image)) {
        onChange(result.image);
        setThumbnailFailed(false);
        lastFile.current = null;
      } else
        setError(
          t.has(result?.error ?? '')
            ? result.error
            : 'referenceImageUploadFailed'
        );
      finish();
    };
    xhr.onerror = xhr.ontimeout = () => {
      setError('referenceImageUploadFailed');
      finish();
    };
    xhr.onabort = finish;
    xhr.send(file);
  }
  return (
    <div className="qw-reference-image" aria-busy={uploading}>
      <div>
        <h3>{t('referenceImageTitle')}</h3>
        <p id="reference-image-hint">{t('referenceImageHint')}</p>
      </div>
      {image && (
        <div className="qw-reference-image-preview">
          {/* Private, authenticated endpoint; Next image optimization must not cache this response. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${image.storagePath}-${retry}`}
            src={`/api/quotations/${quotationId}/image?path=${encodeURIComponent(image.storagePath)}&retry=${retry}`}
            width={image.width}
            height={image.height}
            alt={t('referenceImageAlt')}
            onError={() => setThumbnailFailed(true)}
            onLoad={() => setThumbnailFailed(false)}
          />
          {thumbnailFailed && (
            <div role="alert">
              <p>{t('referenceImageUnavailable')}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setThumbnailFailed(false);
                  setRetry((n) => n + 1);
                }}
              >
                {t('referenceImageRetry')}
              </Button>
            </div>
          )}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        disabled={disabled || uploading}
        aria-label={t('referenceImageTitle')}
        aria-describedby="reference-image-hint"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) upload(file);
        }}
      />
      <div className="qw-reference-image-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <ImagePlus size={15} />
          )}
          {image ? t('referenceImageReplace') : t('referenceImageUpload')}
        </Button>
        {image && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || uploading}
            onClick={() => {
              onChange(undefined);
              setError(null);
              lastFile.current = null;
            }}
          >
            <Trash2 size={15} />
            {t('remove')}
          </Button>
        )}
        {error && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || uploading}
            onClick={() => {
              if (lastFile.current) upload(lastFile.current);
            }}
          >
            <RefreshCw size={15} />
            {t('referenceImageRetry')}
          </Button>
        )}
      </div>
      {uploading && (
        <div role="status" aria-live="polite">
          <p>
            {t(
              progress === 100
                ? 'referenceImageProcessing'
                : 'referenceImageUploading',
              { percent: progress }
            )}
          </p>
          <progress
            aria-label={t('referenceImageUpload')}
            value={progress}
            max={100}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="qw-error">
          {t(error)}
        </p>
      )}
    </div>
  );
}
