import { useCallback, useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Mic, Square, X } from 'lucide-react';
import type Recorder from 'opus-recorder';
type Job = { recorder: Recorder; cancelled: boolean; started: number };
export function VoiceRecorder({
  disabled,
  onRecorded,
  onRecording,
}: {
  disabled: boolean;
  onRecorded: (file: File) => void;
  onRecording: (value: boolean) => void;
}) {
  const serial = useRef(0);
  const starting = useRef(false);
  const job = useRef<Job | null>(null),
    alive = useRef(true),
    timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [state, setState] = useState<
      'idle' | 'starting' | 'recording' | 'finishing'
    >('idle'),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState('');
  const callbacks = useRef({ onRecorded, onRecording });
  callbacks.current = { onRecorded, onRecording };
  const clearTimer = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
  }, []);
  const discard = useCallback(
    (update = true) => {
      serial.current++;
      starting.current = false;
      const current = job.current;
      job.current = null;
      if (current) {
        current.cancelled = true;
        void current.recorder.stop().catch(() => {});
      }
      clearTimer();
      if (update && alive.current) {
        setState('idle');
        callbacks.current.onRecording(false);
      }
    },
    [clearTimer]
  );
  useEffect(() => {
    alive.current = true;
    const background = () => {
      if (document.visibilityState === 'hidden') discard();
    };
    const cancel = () => discard();
    document.addEventListener('visibilitychange', background);
    window.addEventListener('hth:cancel-recording', cancel);
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', (s) => {
          if (!s.isActive) discard();
        })
      : null;
    return () => {
      alive.current = false;
      discard(false);
      document.removeEventListener('visibilitychange', background);
      window.removeEventListener('hth:cancel-recording', cancel);
      void listener?.then((l) => l.remove());
    };
  }, [discard]);
  function stop() {
    const current = job.current;
    if (!current) return;
    clearTimer();
    setState('finishing');
    void current.recorder.stop().catch(() => {
      if (alive.current) {
        discard();
        setError('Could not finish this recording. Please try again.');
      }
    });
  }
  async function start() {
    if (disabled || starting.current || job.current || state !== 'idle') return;
    starting.current = true;
    const request = ++serial.current;
    setError('');
    setState('starting');
    callbacks.current.onRecording(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error('Microphone recording is unavailable on this device.');
      const { default: Encoder } = await import('opus-recorder');
      if (!alive.current || serial.current !== request) return;
      const recorder = new Encoder({
        encoderPath: '/opus/encoderWorker.min.js',
        numberOfChannels: 1,
        encoderApplication: 2048,
        encoderSampleRate: 48000,
        encoderBitRate: 24000,
        streamPages: false,
      });
      const current: Job = { recorder, cancelled: false, started: 0 };
      job.current = current;
      recorder.ondataavailable = (bytes) => {
        if (!alive.current || current.cancelled || job.current !== current)
          return;
        job.current = null;
        starting.current = false;
        clearTimer();
        setState('idle');
        callbacks.current.onRecording(false);
        if (performance.now() - current.started < 500 || !bytes.length) {
          setError('Recording is too short. Please try again.');
          return;
        }
        if (bytes.length > 16 * 1024 * 1024) {
          setError('Recording is too large. Please record a shorter message.');
          return;
        }
        callbacks.current.onRecorded(
          new File([new Uint8Array(bytes)], `voice-${Date.now()}.ogg`, {
            type: 'audio/ogg',
          })
        );
      };
      await recorder.start();
      if (!alive.current || current.cancelled || job.current !== current) {
        await recorder.stop().catch(() => {});
        return;
      }
      current.started = performance.now();
      setSeconds(0);
      setState('recording');
      timer.current = setInterval(() => {
        const elapsed = Math.floor(
          (performance.now() - current.started) / 1000
        );
        setSeconds(elapsed);
        if (elapsed >= 300) stop();
      }, 250);
    } catch {
      if (alive.current && serial.current === request) {
        discard();
        setError(
          'Microphone access failed. Allow microphone access in device settings and try again.'
        );
      }
    }
  }
  return (
    <div className={`voice-recorder ${state !== 'idle' ? 'is-recording' : ''}`}>
      {state === 'idle' ? (
        <button
          className="icon-button"
          aria-label="Record voice message"
          disabled={disabled}
          onClick={() => void start()}
        >
          <Mic size={21} />
        </button>
      ) : (
        <>
          <button
            className="icon-button"
            aria-label="Discard recording"
            onClick={() => discard()}
          >
            <X size={20} />
          </button>
          <span role="status">
            {state === 'starting'
              ? 'Microphone…'
              : state === 'finishing'
                ? 'Preparing…'
                : `Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
          </span>
          <button
            className="icon-button"
            aria-label="Stop recording"
            disabled={state !== 'recording'}
            onClick={stop}
          >
            <Square size={19} />
          </button>
        </>
      )}
      {error && (
        <span className="voice-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
