'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Bot,
  RotateCcw,
  Send,
  Loader2,
  UserCircle2,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
}

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const copy = useTranslations('Workspace');
  const guide = useTranslations('Workspace.agentGuide');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showScenarios, setShowScenarios] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send only role+content — the server ignores anything else.
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(copy('notConfigured'));
        } else {
          toast.error(data.error ?? copy('replyError'));
        }
        // Roll the unsent user turn back so the transcript stays clean.
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
        },
      ]);
    } catch {
      toast.error(copy('networkError'));
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="crm-agent-playground-grid">
      <aside className="crm-agent-test-guide">
        <span className="bg-primary-soft text-primary hidden size-11 items-center justify-center rounded-xl md:inline-flex">
          <Bot className="size-5" />
        </span>
        <h2 className="text-lg font-semibold tracking-tight md:mt-5 md:text-xl">
          {guide('title')}
        </h2>
        <p className="text-muted-foreground mt-3 hidden text-sm leading-relaxed md:block">
          {guide('hint')}
        </p>
        <button
          type="button"
          onClick={() => setShowScenarios((show) => !show)}
          aria-expanded={showScenarios}
          aria-controls="agent-test-scenarios"
          className="text-primary focus-visible:outline-ring mt-3 rounded text-sm focus-visible:outline-2 md:hidden"
        >
          {guide('scenarioTitle')}
        </button>
        <div
          id="agent-test-scenarios"
          className={cn(!showScenarios && 'hidden md:block')}
        >
          <h3 className="text-muted-foreground mt-8 mb-3 text-xs font-medium">
            {guide('scenarioTitle')}
          </h3>
          <div className="space-y-2">
            {(['product', 'handoff', 'uncertainty'] as const).map(
              (scenario) => (
                <button
                  key={scenario}
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    setInput(guide(`${scenario}Prompt`));
                    inputRef.current?.focus();
                  }}
                  className="border-border hover:bg-muted focus-visible:outline-ring flex w-full items-center justify-between gap-3 rounded-lg border px-5 py-4 text-start text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                >
                  {guide(scenario)}
                  <ArrowRight className="text-muted-foreground size-3.5 shrink-0 rtl:rotate-180" />
                </button>
              )
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed md:mt-6">
          {guide('note')}
        </p>
      </aside>
      <div className="crm-ai-transcript border-border bg-card flex h-[60dvh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border">
        {/* Header */}
        <div className="border-border flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Bot className="text-primary h-4 w-4" />
            <span className="text-foreground text-sm font-medium">
              {copy('playground')}
            </span>
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {copy('testHint')}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTurns([])}
            disabled={turns.length === 0 || sending}
            className="text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {copy('reset')}
          </Button>
        </div>

        {/* Transcript */}
        <div
          ref={scrollRef}
          className="crm-ai-transcript-scroll min-h-0 flex-1 space-y-6 overflow-y-auto p-5"
          role="log"
          aria-label={copy('playground')}
          aria-live="polite"
          dir="ltr"
        >
          {turns.length === 0 && (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center px-4 text-center text-sm">
              <Bot className="text-muted-foreground/60 mb-5 h-10 w-10" />
              <p>{copy('testEmpty')}</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed">
                {copy('testEmptyHint')}
              </p>
              {onGoToSetup && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={onGoToSetup}
                  className="mt-1 h-auto p-0 text-xs"
                >
                  {copy('goToSetup')}{' '}
                  <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                </Button>
              )}
            </div>
          )}

          {turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-3',
                t.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {t.role === 'assistant' && (
                <Bot className="text-primary mt-1 h-5 w-5 shrink-0" />
              )}
              <div
                className={cn(
                  'max-w-[80%] min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]',
                  t.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted text-foreground rounded-bl-sm'
                )}
              >
                {t.content && (
                  <p dir="auto" className="whitespace-pre-wrap">
                    {t.content}
                  </p>
                )}
                {t.role === 'assistant' && t.handoff && (
                  <p
                    className={cn(
                      'text-warning flex items-center gap-1 text-xs',
                      t.content && 'border-border/50 mt-1.5 border-t pt-1.5'
                    )}
                  >
                    <UserCircle2 className="h-3.5 w-3.5" />
                    {copy('handoff')}
                  </p>
                )}
              </div>
              {t.role === 'user' && (
                <UserCircle2 className="text-muted-foreground mt-1 h-5 w-5 shrink-0" />
              )}
            </div>
          ))}

          {sending && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Bot className="text-primary h-5 w-5" />
              <Loader2 className="h-4 w-4 animate-spin" /> {copy('thinking')}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-border flex shrink-0 items-center gap-3 border-t p-4">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={copy('testMessage')}
            aria-label={copy('testMessage')}
            dir="auto"
            rows={1}
            className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 min-w-0 flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm outline-none"
          />
          <Button
            size="sm"
            aria-label={copy('sendTest')}
            onClick={send}
            disabled={!input.trim() || sending}
            className="h-9 w-9 shrink-0 p-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
