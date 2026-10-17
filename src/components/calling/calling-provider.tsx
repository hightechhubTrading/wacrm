'use client';

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Phone, PhoneOff, Mic, MicOff, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { waitForIce, waitForConnection } from '@/lib/whatsapp/calling/webrtc';
import { sameCalls } from '@/lib/whatsapp/calling/snapshots';
import { isActiveCall, type CallRecord } from '@/lib/whatsapp/calling/types';
import './calling.css';

export async function callingFetch<T>(
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`/api/whatsapp/calls${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Calling request failed.');
  return result;
}
interface CallingContextValue {
  enabled: boolean;
  busy: boolean;
  start: (conversationId: string) => Promise<void>;
  refreshSettings: () => Promise<void>;
  enableSound: () => Promise<void>;
  soundEnabled: boolean;
}
const CallingContext = createContext<CallingContextValue | null>(null);
export const useCalling = () => useContext(CallingContext);

export function CallingProvider({ children }: { children: ReactNode }) {
  const { accountId, user, canSendMessages } = useAuth();
  const t = useTranslations('Calling');
  const [enabled, setEnabled] = useState(false);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [current, setCurrent] = useState<CallRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundRef = useRef<AudioContext | null>(null);
  const ownedRef = useRef<CallRecord | null>(null);
  const clientRef = useRef('');
  const operatingRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const mutedRef = useRef(false);

  useEffect(() => {
    clientRef.current = crypto.randomUUID();
  }, []);

  const cleanup = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    ownedRef.current = null;
    mutedRef.current = false;
    setCurrent(null);
    setMuted(false);
    setAudioBlocked(false);
    setElapsed(0);
  }, []);

  const action = useCallback(
    async (call: CallRecord, actionName: string, sdp?: string) => {
      return callingFetch<{ call?: CallRecord }>(`/${call.id}`, {
        action: actionName,
        client_id: clientRef.current,
        ...(sdp ? { sdp } : {}),
      });
    },
    []
  );

  const refreshSettings = useCallback(async () => {
    if (!accountId || !canSendMessages) {
      setEnabled(false);
      return;
    }
    try {
      const result = await callingFetch<{ enabled: boolean }>('/settings');
      setEnabled(result.enabled);
    } catch {
      setEnabled(false);
    }
  }, [accountId, canSendMessages]);

  const refresh = useCallback(async () => {
    if (!accountId || !canSendMessages) return;
    const generation = ++requestGenerationRef.current;
    try {
      const result = await callingFetch<{ calls: CallRecord[] }>('');
      if (generation !== requestGenerationRef.current) return;
      setCalls((previous) =>
        sameCalls(previous, result.calls) ? previous : result.calls
      );
      const owned = ownedRef.current;
      if (owned) {
        const updated = result.calls.find((call) => call.id === owned.id);
        if (!updated || !isActiveCall(updated.state)) {
          cleanup();
          return;
        }
        ownedRef.current = updated;
        setCurrent((previous) =>
          previous && sameCalls([previous], [updated]) ? previous : updated
        );
        const peer = peerRef.current;
        if (
          updated.direction === 'outbound' &&
          updated.remote_sdp_type === 'answer' &&
          updated.remote_sdp &&
          peer?.signalingState === 'have-local-offer'
        ) {
          await peer.setRemoteDescription({
            type: 'answer',
            sdp: updated.remote_sdp,
          });
        }
      }
    } catch {
      // A transient polling failure does not interrupt working audio. Realtime
      // and the next poll both resynchronize from persisted state.
    }
  }, [accountId, canSendMessages, cleanup]);

  useEffect(() => {
    void refreshSettings();
    void refresh();
    if (!accountId || !canSendMessages) return;
    const db = createClient();
    const channel = db
      .channel(`calling:${accountId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_calls',
          filter: `account_id=eq.${accountId}`,
        },
        () => {
          void refresh();
        }
      )
      .subscribe();
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    const settingsTimer = setInterval(() => {
      void refreshSettings();
    }, 30_000);
    const resume = () => {
      void refresh();
      void refreshSettings();
    };
    window.addEventListener('focus', resume);
    return () => {
      clearInterval(timer);
      clearInterval(settingsTimer);
      window.removeEventListener('focus', resume);
      void db.removeChannel(channel);
    };
  }, [accountId, canSendMessages, refresh, refreshSettings]);

  useEffect(() => {
    let exitSentFor: string | null = null;
    const endOnExit = () => {
      const call = ownedRef.current;
      if (call && exitSentFor !== call.id) {
        const sent = navigator.sendBeacon(
          `/api/whatsapp/calls/${call.id}`,
          new Blob(
            [
              JSON.stringify({
                action: 'terminate',
                client_id: clientRef.current,
              }),
            ],
            { type: 'application/json' }
          )
        );
        if (sent) exitSentFor = call.id;
      }
    };
    window.addEventListener('beforeunload', endOnExit);
    window.addEventListener('pagehide', endOnExit);
    return () => {
      endOnExit();
      window.removeEventListener('pagehide', endOnExit);
      window.removeEventListener('beforeunload', endOnExit);
      peerRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      ownedRef.current = null;
      cleanup();
    };
  }, [accountId, cleanup]);

  useEffect(() => {
    if (!current?.answered_at) return;
    const tick = () =>
      setElapsed(
        Math.max(
          0,
          Math.floor((Date.now() - Date.parse(current.answered_at!)) / 1000)
        )
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [current?.answered_at]);

  const incoming = enabled
    ? calls.find(
        (call) =>
          call.direction === 'inbound' &&
          call.state === 'ringing' &&
          !call.agent_user_id &&
          Date.now() - Date.parse(call.created_at) < 60_000
      )
    : undefined;
  const incomingId = incoming?.id;
  const currentId = current?.id;
  useEffect(() => {
    if (!incomingId || !soundEnabled || currentId) return;
    const ring = () => {
      const context = soundRef.current;
      if (!context || context.state !== 'running') return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.value = 440;
      gain.gain.setValueAtTime(0.06, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.5);
    };
    ring();
    const timer = setInterval(ring, 2000);
    return () => clearInterval(timer);
  }, [incomingId, soundEnabled, currentId]);

  const enableSound = useCallback(async () => {
    soundRef.current ??= new AudioContext();
    await soundRef.current.resume();
    setSoundEnabled(true);
  }, []);

  const makePeer = useCallback(
    async (inbound: boolean, iceServers: RTCIceServer[]) => {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(t('microphoneUnavailable'));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      streamRef.current = stream;
      const peer = new RTCPeerConnection({ iceServers });
      peerRef.current = peer;
      for (const track of stream.getAudioTracks()) {
        // Pre-accept negotiates media but must not send the agent's voice before
        // Meta acknowledges accept. Outgoing is gated until the peer connects.
        track.enabled = false;
        peer.addTrack(track, stream);
      }
      // Opus is enabled by default on Meta. Avoid negotiating other codecs
      // unless the number is explicitly configured to support them.
      const codecs = RTCRtpSender.getCapabilities('audio')?.codecs.filter(
        (codec) =>
          codec.mimeType.toLowerCase() === 'audio/opus' ||
          (codec.mimeType.toLowerCase() === 'audio/telephone-event' &&
            codec.clockRate === 8000)
      );
      if (
        codecs?.some((codec) => codec.mimeType.toLowerCase() === 'audio/opus')
      ) {
        for (const transceiver of peer.getTransceivers())
          transceiver.setCodecPreferences(codecs);
      }
      peer.ontrack = (event) => {
        const audio = audioRef.current;
        if (audio) {
          audio.srcObject = event.streams[0] || new MediaStream([event.track]);
          void audio.play().catch(() => setAudioBlocked(true));
        }
      };
      peer.onconnectionstatechange = () => {
        if (!inbound && peer.connectionState === 'connected')
          stream.getAudioTracks().forEach((track) => {
            track.enabled = !mutedRef.current;
          });
        if (peer.connectionState === 'failed') {
          setError(t('connectionFailed'));
          const owned = ownedRef.current;
          if (owned)
            void action(owned, 'terminate')
              .then(cleanup)
              .catch(() => {});
        }
      };
      return peer;
    },
    [t, action, cleanup]
  );

  const audioConfig = async () => {
    const result = await callingFetch<{ iceServers: RTCIceServer[] }>(
      '/audio-config'
    );
    return result.iceServers;
  };

  const start = useCallback(
    async (conversationId: string) => {
      if (operatingRef.current || ownedRef.current)
        throw new Error(t('alreadyOnCall'));
      operatingRef.current = true;
      setBusy(true);
      setError('');
      try {
        const peer = await makePeer(false, await audioConfig());
        await peer.setLocalDescription(await peer.createOffer());
        const sdp = await waitForIce(peer);
        const result = await callingFetch<{ call: CallRecord }>('', {
          conversation_id: conversationId,
          client_id: clientRef.current,
          sdp,
        });
        requestGenerationRef.current++;
        ownedRef.current = result.call;
        setCurrent(result.call);
        if (!isActiveCall(result.call.state)) {
          cleanup();
          throw new Error(t('callEnded'));
        }
        if (result.call.remote_sdp_type === 'answer' && result.call.remote_sdp)
          await peer.setRemoteDescription({
            type: 'answer',
            sdp: result.call.remote_sdp,
          });
        void refresh();
      } catch (error) {
        const owned = ownedRef.current;
        if (owned) await action(owned, 'terminate').catch(() => {});
        cleanup();
        throw error;
      } finally {
        operatingRef.current = false;
        setBusy(false);
      }
    },
    [makePeer, refresh, cleanup, action, t]
  );

  const answer = async (call: CallRecord) => {
    if (operatingRef.current || ownedRef.current) return;
    operatingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const peer = await makePeer(true, await audioConfig());
      const { call: claimed } = await action(call, 'claim');
      if (!claimed) throw new Error(t('missingOffer'));
      requestGenerationRef.current++;
      ownedRef.current = claimed;
      setCurrent(claimed);
      if (!claimed.remote_sdp || claimed.remote_sdp_type !== 'offer')
        throw new Error(t('missingOffer'));
      await peer.setRemoteDescription({
        type: 'offer',
        sdp: claimed.remote_sdp,
      });
      await peer.setLocalDescription(await peer.createAnswer());
      const sdp = await waitForIce(peer);
      await action(claimed, 'pre_accept', sdp);
      await waitForConnection(peer);
      await action(claimed, 'accept', sdp);
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('connectionFailed'));
      const owned = ownedRef.current;
      if (owned) await action(owned, 'terminate').catch(() => {});
      cleanup();
    } finally {
      operatingRef.current = false;
      setBusy(false);
    }
  };

  const end = async (call: CallRecord, actionName: 'reject' | 'terminate') => {
    if (operatingRef.current) return;
    operatingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action(call, actionName);
      if (ownedRef.current?.id === call.id) cleanup();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('connectionFailed'));
    } finally {
      operatingRef.current = false;
      setBusy(false);
    }
  };

  // Offer a way to end a call left behind by a crashed/reloaded browser.
  const stranded = !current
    ? calls.find(
        (call) => call.agent_user_id === user?.id && call.state !== 'ringing'
      )
    : undefined;
  const shown = current || incoming || stranded;
  const callingBusy = busy || !!current || !!stranded;
  const contextValue = useMemo(
    () => ({
      enabled,
      busy: callingBusy,
      start,
      refreshSettings,
      enableSound,
      soundEnabled,
    }),
    [enabled, callingBusy, start, refreshSettings, enableSound, soundEnabled]
  );
  return (
    <CallingContext.Provider value={contextValue}>
      {children}
      <audio ref={audioRef} autoPlay className="hidden" />
      {canSendMessages && shown && (
        <aside className="crm-call-panel" aria-label={t('title')}>
          <div className="crm-call-identity flex min-w-0 items-start gap-3">
            <div className="crm-call-avatar">
              <Phone className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-xs" role="status">
                {current
                  ? t(current.state === 'active' ? 'active' : 'connecting')
                  : incoming
                    ? t('incoming')
                    : t('otherBrowser')}
              </p>
              <p className="truncate font-semibold">
                {shown.customer_name ||
                  shown.customer_phone ||
                  t('unknownCaller')}
              </p>
              {current?.answered_at && (
                <p className="text-muted-foreground text-xs tabular-nums">
                  {Math.floor(elapsed / 60)}:
                  {String(elapsed % 60).padStart(2, '0')}
                </p>
              )}
            </div>
            {shown.conversation_id && (
              <Link
                className="text-primary text-xs underline underline-offset-4"
                href={`/inbox?c=${shown.conversation_id}`}
              >
                {t('openChat')}
              </Link>
            )}
          </div>
          <div className="crm-call-controls flex flex-wrap items-center gap-2">
            {current ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={muted}
                  onClick={() => {
                    streamRef.current?.getAudioTracks().forEach((track) => {
                      track.enabled = muted;
                    });
                    mutedRef.current = !muted;
                    setMuted(!muted);
                  }}
                  disabled={busy || current.state !== 'active'}
                >
                  {muted ? <MicOff /> : <Mic />}
                  {t(muted ? 'unmute' : 'mute')}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void end(current, 'terminate')}
                >
                  <PhoneOff />
                  {t('hangUp')}
                </Button>
              </>
            ) : incoming ? (
              <>
                <Button
                  size="sm"
                  disabled={busy || !!stranded}
                  onClick={() => void answer(incoming)}
                >
                  <Phone />
                  {t('answer')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void end(incoming, 'reject')}
                >
                  <PhoneOff />
                  {t('decline')}
                </Button>
              </>
            ) : (
              stranded && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void end(stranded, 'terminate')}
                >
                  <PhoneOff />
                  {t('hangUp')}
                </Button>
              )
            )}
            {audioBlocked && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void audioRef.current
                    ?.play()
                    .then(() => setAudioBlocked(false));
                }}
              >
                <Volume2 />
                {t('enableAudio')}
              </Button>
            )}
          </div>
          {error && (
            <p className="text-destructive mt-3 text-xs" role="alert">
              {error}
            </p>
          )}
        </aside>
      )}
      {!shown && error && (
        <div className="crm-call-panel" role="alert">
          <p className="text-destructive text-sm">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => setError('')}>
            {t('dismiss')}
          </Button>
        </div>
      )}
    </CallingContext.Provider>
  );
}
