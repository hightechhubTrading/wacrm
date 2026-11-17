import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Expand,
  ImageIcon,
  Pause,
  Play,
  RotateCw,
  Volume2,
} from 'lucide-react';
import { activateVoice, releaseVoice, useChatMedia } from './chat-media';
import type { Message } from './workspace-ui';

function useNearViewport() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      {
        root: el.closest('.transcript'),
        rootMargin: '120px',
      }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}
export function InlinePhoto({
  message,
  onOpen,
}: {
  message: Message;
  onOpen: () => void;
}) {
  const { ref, visible } = useNearViewport();
  const [attempt, setAttempt] = useState(0);
  const [decodeError, setDecodeError] = useState(false);
  const { loaded, error } = useChatMedia(
    message.id,
    'image',
    visible && !!message.media_url,
    attempt
  );
  const failed = error || decodeError || !message.media_url;
  return (
    <div className="inline-photo" ref={ref}>
      <button
        className="photo-open"
        aria-label="View photo"
        onClick={onOpen}
        disabled={!loaded || !!failed}
      >
        {loaded && !failed ? (
          <>
            {/* Authenticated local blob in the Vite app. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={loaded.url}
              alt={message.content_text || 'Shared photo'}
              decoding="async"
              data-ready={loaded.cached ? 'true' : undefined}
              onLoad={(e) => e.currentTarget.setAttribute('data-ready', 'true')}
              onError={() => setDecodeError(true)}
            />
            <span className="photo-expand">
              <Expand size={16} aria-hidden="true" />
            </span>
          </>
        ) : (
          <span className="photo-placeholder">
            <ImageIcon size={28} strokeWidth={1.5} aria-hidden="true" />
            <span>{failed ? 'Photo unavailable' : 'Loading photo…'}</span>
          </span>
        )}
      </button>
      {failed && (
        <div className="inline-media-error">
          <span>
            {typeof error === 'string' && error ? error : 'Photo unavailable'}
          </span>
          {message.media_url && (
            <button
              aria-label="Retry photo"
              onClick={() => {
                setDecodeError(false);
                setAttempt((n) => n + 1);
              }}
            >
              <RotateCw size={14} />
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function clock(value: number) {
  const time = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
}
export function InlineVoice({ message }: { message: Message }) {
  const { ref, visible } = useNearViewport();
  const player = useRef<HTMLAudioElement>(null);
  const seek = useRef<HTMLInputElement>(null);
  const displayedSecond = useRef(-1);
  const wanted = useRef(false);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playError, setPlayError] = useState('');
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const draw = () => {
      const audio = player.current;
      if (!audio) return;
      if (seek.current) {
        seek.current.value = String(audio.currentTime);
        seek.current.style.setProperty(
          '--voice-progress',
          `${duration ? (audio.currentTime / duration) * 100 : 0}%`
        );
      }
      const second = Math.floor(audio.currentTime);
      if (second !== displayedSecond.current) {
        displayedSecond.current = second;
        setPosition(audio.currentTime);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  const { loaded, error, loading } = useChatMedia(
    message.id,
    'audio',
    (visible || requested || playing) && !!message.media_url,
    attempt
  );
  async function play() {
    const audio = player.current;
    if (!audio) return;
    try {
      activateVoice(audio);
      audio.playbackRate = speed;
      await audio.play();
      wanted.current = false;
      setPlayError('');
    } catch {
      wanted.current = false;
      setPlayError('Tap play to start this recording.');
    }
  }
  useEffect(() => {
    const audio = player.current;
    return () => {
      if (audio) releaseVoice(audio);
    };
  }, [loaded?.url]);
  const failed = error || playError || !message.media_url;
  return (
    <div className="inline-voice" ref={ref}>
      <div className="voice-row">
        <button
          className="voice-play"
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
          disabled={!message.media_url}
          aria-busy={loading}
          onClick={() => {
            if (playing) {
              wanted.current = false;
              player.current?.pause();
              return;
            }
            wanted.current = true;
            setRequested(true);
            if (error) {
              setAttempt((n) => n + 1);
              return;
            }
            if (loaded) void play();
          }}
        >
          {playing ? (
            <Pause size={21} fill="currentColor" />
          ) : (
            <Play size={21} fill="currentColor" />
          )}
        </button>
        <div className="voice-progress">
          <input
            ref={seek}
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            defaultValue={0}
            disabled={!loaded || !duration}
            aria-label="Seek voice message"
            aria-valuetext={`${clock(position)} of ${clock(duration)}`}
            style={
              {
                '--voice-progress': `${duration ? (position / duration) * 100 : 0}%`,
              } as CSSProperties
            }
            onChange={(e) => {
              const time = Number(e.target.value);
              if (player.current) player.current.currentTime = time;
              setPosition(time);
            }}
          />
          <div className="voice-caption">
            <span>
              {loading
                ? 'Loading voice…'
                : duration
                  ? position
                    ? `${clock(position)} / ${clock(duration)}`
                    : clock(duration)
                  : 'Voice message'}
            </span>
            <Volume2 size={13} aria-hidden="true" />
          </div>
        </div>
        <button
          className="voice-speed"
          aria-label={`Playback speed ${speed} times`}
          onClick={() => {
            const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
            setSpeed(next);
            if (player.current) player.current.playbackRate = next;
          }}
        >
          {speed}×
        </button>
      </div>
      {loaded && (
        <audio
          ref={player}
          src={loaded.url}
          preload="metadata"
          aria-label="Voice message playback"
          onLoadedMetadata={() => {
            if (seek.current)
              seek.current.value = String(player.current?.currentTime ?? 0);
            setPosition(player.current?.currentTime ?? 0);
            if (player.current && Number.isFinite(player.current.duration))
              setDuration(player.current.duration);
          }}
          onCanPlay={() => {
            if (wanted.current) void play();
          }}
          onPlay={() => {
            if (player.current) activateVoice(player.current);
            setPlaying(true);
            setRequested(false);
          }}
          onPause={() => {
            setPosition(player.current?.currentTime ?? 0);
            setPlaying(false);
            setRequested(false);
          }}
          onTimeUpdate={() => {
            if (!playing) setPosition(player.current?.currentTime ?? 0);
          }}
          onEnded={() => {
            setPosition(player.current?.currentTime ?? duration);
            if (seek.current)
              seek.current.value = String(
                player.current?.currentTime ?? duration
              );
            setPlaying(false);
            wanted.current = false;
          }}
          onError={() =>
            setPlayError('This recording cannot be played on this device.')
          }
        />
      )}
      {failed && (
        <div className="inline-media-error">
          <span>
            {typeof failed === 'string' ? failed : 'Voice message unavailable'}
          </span>
          {message.media_url && (
            <button
              aria-label="Retry voice message"
              onClick={() => {
                setPlayError('');
                setAttempt((n) => n + 1);
                setRequested(true);
              }}
            >
              <RotateCw size={14} />
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
