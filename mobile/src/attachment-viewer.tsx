import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  X,
  ZoomIn,
  ZoomOut,
  Headphones,
} from 'lucide-react';
import { useChatMedia, activateVoice } from './chat-media';
import type { Message } from './workspace-ui';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const files = registerPlugin<{
  open(options: { data: string; mime: string }): Promise<void>;
  clear(): Promise<void>;
}>('AttachmentFiles');
export async function clearAttachmentFiles() {
  if (Capacitor.getPlatform() === 'android') await files.clear();
}
export function AttachmentButton({
  message,
  onOpen,
}: {
  message: Message;
  onOpen: () => void;
}) {
  const photo = message.content_type === 'image';
  const audio = message.content_type === 'audio';
  const extension = message.content_text
    ?.trim()
    .match(/\.([a-z0-9]{2,5})$/i)?.[1]
    ?.toUpperCase();
  return (
    <button
      className="attachment-card"
      aria-label={
        photo
          ? 'View photo'
          : audio
            ? 'Play voice message'
            : `View document${message.content_text ? `: ${message.content_text}` : ''}`
      }
      onClick={onOpen}
      disabled={!message.media_url}
    >
      {photo ? (
        <ImageIcon size={24} aria-hidden="true" />
      ) : audio ? (
        <Headphones size={24} aria-hidden="true" />
      ) : (
        <FileText size={24} aria-hidden="true" />
      )}
      <span>
        <strong dir="auto">
          {photo
            ? 'View photo'
            : audio
              ? 'Play voice message'
              : message.content_text || 'Document'}
        </strong>
        <small>
          {message.media_url
            ? photo || audio
              ? 'Tap to load'
              : extension
                ? `${extension} document`
                : 'Document'
            : 'Attachment unavailable'}
        </small>
      </span>
    </button>
  );
}
export function AttachmentViewer({
  message,
  onClose,
}: {
  message: Message;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const audioPlayer = useRef<HTMLAudioElement>(null);
  const [actionError, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const [zoom, setZoom] = useState(1);
  const photo = message.content_type === 'image';
  const audio = message.content_type === 'audio';
  const { loaded, error: loadError } = useChatMedia(
    message.id,
    message.content_type,
    true,
    attempt
  );
  const error = loadError || actionError;
  useEffect(() => {
    const player = audioPlayer.current;
    return () => {
      player?.pause();
      player?.removeAttribute('src');
      player?.load();
    };
  }, [loaded, audio]);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  async function openFile() {
    if (!loaded || opening) return;
    setOpening(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not open document.'));
        reader.readAsDataURL(loaded.blob);
      });
      await files.open({ data, mime: loaded.type });
    } catch {
      setError(
        'No compatible viewer is available, or the document could not be opened.'
      );
    } finally {
      setOpening(false);
    }
  }
  return (
    <dialog
      className="attachment-viewer"
      ref={dialog}
      aria-labelledby="attachment-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="attachment-toolbar">
        <h2 id="attachment-title">
          {photo
            ? 'Photo'
            : audio
              ? 'Voice message'
              : loaded?.type === 'application/pdf'
                ? 'PDF document'
                : 'Document'}
        </h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close attachment"
        >
          <X size={22} />
        </button>
      </header>
      {error && (
        <div className="attachment-error" role="alert">
          <p>{error}</p>
          {!loaded && (
            <button
              onClick={() => {
                setError('');
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!loaded && !error && (
        <p className="attachment-loading" role="status">
          Loading attachment…
        </p>
      )}
      {loaded && photo && (
        <>
          <div
            className="attachment-actions"
            role="group"
            aria-label="Photo zoom"
          >
            <button
              className="icon-button"
              disabled={zoom <= 1}
              onClick={() => setZoom((n) => Math.max(1, n - 0.5))}
              aria-label="Zoom out"
            >
              <ZoomOut size={20} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="icon-button"
              disabled={zoom >= 3}
              onClick={() => setZoom((n) => Math.min(3, n + 0.5))}
              aria-label="Zoom in"
            >
              <ZoomIn size={20} />
            </button>
          </div>
          <div className="photo-scroll">
            {/* Local Vite/Capacitor blob; no Next image server. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={loaded.url}
              alt={message.content_text || 'Shared photo'}
              style={{ width: `${zoom * 100}%` }}
              onError={() => setError('This photo could not be decoded.')}
            />
          </div>
        </>
      )}
      {loaded && audio && (
        <div className="voice-player">
          <Headphones size={40} aria-hidden="true" />
          <p>Voice message</p>
          <audio
            ref={audioPlayer}
            onPlay={() => {
              if (audioPlayer.current) activateVoice(audioPlayer.current);
            }}
            controls
            preload="metadata"
            src={loaded.url}
            aria-label="Voice message playback"
            onError={() =>
              setError('This recording cannot be played on this device.')
            }
          />
          <small>Use the player to play, pause or seek.</small>
        </div>
      )}
      {loaded && !photo && !audio && loaded.type === 'application/pdf' && (
        <PdfPreview blob={loaded.blob} />
      )}
      {loaded && !photo && !audio && loaded.type !== 'application/pdf' && (
        <div className="document-summary">
          <FileText size={40} />
          <p>This document opens in a compatible app on your device.</p>
        </div>
      )}
      {loaded && !photo && !audio && (
        <footer className="attachment-actions">
          <span>{(loaded.blob.size / 1024).toFixed(0)} KB</span>
          {Capacitor.getPlatform() === 'android' ? (
            <button
              className="document-open"
              disabled={opening}
              onClick={() => void openFile()}
            >
              <ExternalLink size={18} />
              {opening ? 'Opening…' : 'Open on device'}
            </button>
          ) : (
            <a
              className="document-open"
              href={loaded.url}
              download={
                loaded.type === 'application/pdf' ? 'document.pdf' : 'document'
              }
            >
              Download document
            </a>
          )}
        </footer>
      )}
    </dialog>
  );
}

export function PdfPreview({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [text, setText] = useState('');
  useEffect(() => {
    let disposed = false;
    let task:
      ReturnType<(typeof import('pdfjs-dist'))['getDocument']> | undefined;
    void (async () => {
      try {
        const lib = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        if (disposed) return;
        lib.GlobalWorkerOptions.workerSrc = worker.default;
        task = lib.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          cMapUrl: '/pdf-assets/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdf-assets/standard_fonts/',
          useWasm: false,
        });
        const doc = await task.promise;
        if (!disposed) setPdf(doc);
      } catch {
        if (!disposed) {
          setError(
            'This PDF could not be previewed. It may be damaged or password protected.'
          );
          setRendering(false);
        }
      }
    })();
    return () => {
      disposed = true;
      void task?.destroy();
    };
  }, [blob]);
  useEffect(() => {
    if (!pdf) return;
    let disposed = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>
      | undefined;
    const frame = requestAnimationFrame(() => {
      setRendering(true);
      setText('');
    });
    void (async () => {
      try {
        const sheet = await pdf.getPage(page);
        const target = canvas.current;
        if (disposed || !target) return;
        const base = sheet.getViewport({ scale: 1 });
        if (
          !Number.isFinite(base.width) ||
          base.width <= 0 ||
          base.height / base.width > 20
        )
          throw new Error('Unsupported PDF dimensions');
        const width = Math.max(240, (scroll.current?.clientWidth ?? 360) - 24);
        const viewport = sheet.getViewport({
          scale: (width / base.width) * zoom,
        });
        const scale = Math.min(
          2,
          devicePixelRatio || 1,
          4096 / Math.max(viewport.width, viewport.height)
        );
        target.width = Math.floor(viewport.width * scale);
        target.height = Math.floor(viewport.height * scale);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        render = sheet.render({
          canvas: target,
          viewport,
          transform: [scale, 0, 0, scale, 0, 0],
        });
        await render.promise;
        const content = await sheet.getTextContent();
        if (!disposed) {
          setText(
            content.items.map((i) => ('str' in i ? i.str : '')).join(' ')
          );
          setRendering(false);
        }
      } catch {
        if (!disposed) {
          setError(
            'Could not render this PDF page. Try opening it on your device.'
          );
          setRendering(false);
        }
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      render?.cancel();
    };
  }, [pdf, page, zoom]);
  return (
    <div className="pdf-preview">
      <div
        className="attachment-actions"
        role="group"
        aria-label="PDF navigation"
      >
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page <= 1 || rendering}
          onClick={() => setPage((n) => n - 1)}
        >
          <ChevronLeft size={20} />
        </button>
        <span>
          Page {page} of {pdf?.numPages ?? '…'}
        </span>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={!pdf || page >= pdf.numPages || rendering}
          onClick={() => setPage((n) => n + 1)}
        >
          <ChevronRight size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="Zoom out"
          disabled={zoom <= 1 || rendering}
          onClick={() => setZoom((n) => n - 0.5)}
        >
          <ZoomOut size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="Zoom in"
          disabled={zoom >= 2 || rendering}
          onClick={() => setZoom((n) => n + 0.5)}
        >
          <ZoomIn size={20} />
        </button>
      </div>
      {rendering && (
        <p className="pdf-status" role="status">
          Rendering page…
        </p>
      )}
      {error && (
        <p className="attachment-error" role="alert">
          {error}
        </p>
      )}
      <div className="pdf-scroll" ref={scroll}>
        <canvas ref={canvas} role="img" aria-label={`PDF page ${page}`} />
        {text && (
          <details className="pdf-text">
            <summary>Page text</summary>
            <p dir="auto">{text}</p>
          </details>
        )}
      </div>
    </div>
  );
}
