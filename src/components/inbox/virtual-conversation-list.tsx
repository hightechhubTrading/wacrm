'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Conversation } from '@/types';

type Section = { key: string; label: string; items: Conversation[] };
type Row =
  | { key: string; conversation: Conversation }
  | { key: string; label: string; count: number };

/** Variable-height windowing: keep groups and full-data filtering, without
 * mounting hundreds of avatars, dates and buttons outside the viewport. */
export function VirtualConversationList({
  sections,
  renderItem,
}: {
  sections: Section[];
  renderItem: (conversation: Conversation) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState(() => new Map<string, number>());
  const [window, setWindow] = useState({ top: 0, height: 800 });
  const rows = useMemo<Row[]>(
    () =>
      sections.flatMap((section) =>
        section.items.length
          ? [
              {
                key: `group:${section.key}`,
                label: section.label,
                count: section.items.length,
              },
              ...section.items.map((conversation) => ({
                key: conversation.id,
                conversation,
              })),
            ]
          : []
      ),
    [sections]
  );
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows)
      result.push(
        result[result.length - 1] +
          (heights.get(row.key) ?? ('conversation' in row ? 78 : 43))
      );
    return result;
  }, [rows, heights]);
  const measure = useCallback((key: string, height: number) => {
    if (height <= 0) return;
    setHeights((previous) =>
      previous.get(key) === height
        ? previous
        : new Map(previous).set(key, height)
    );
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () =>
      setWindow({ top: element.scrollTop, height: element.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const total = offsets[rows.length];
  const top = Math.min(window.top, Math.max(0, total - window.height));
  const start = Math.max(
    0,
    offsets.findIndex((offset) => offset >= top - 350) - 1
  );
  const endIndex = offsets.findIndex(
    (offset) => offset > top + window.height + 350
  );
  const end = endIndex < 0 ? rows.length : endIndex;

  return (
    <div
      ref={viewport}
      className="min-h-0 flex-1 overflow-y-auto"
      data-conversation-viewport
      onScroll={(event) =>
        setWindow({
          top: event.currentTarget.scrollTop,
          height: event.currentTarget.clientHeight,
        })
      }
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
          return;
        const wrapper = (event.target as HTMLElement).closest<HTMLElement>(
          '[data-conversation-index]'
        );
        if (!wrapper) return;
        let index = Number(wrapper.dataset.conversationIndex);
        const direction =
          event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
        if (event.key === 'Home') index = -1;
        if (event.key === 'End') index = rows.length;
        do {
          index += direction;
        } while (
          index >= 0 &&
          index < rows.length &&
          !('conversation' in rows[index])
        );
        if (index < 0 || index >= rows.length) return;
        event.preventDefault();
        const element = viewport.current!;
        if (
          offsets[index] < element.scrollTop ||
          offsets[index + 1] > element.scrollTop + element.clientHeight
        ) {
          element.scrollTop = offsets[index];
          setWindow({ top: element.scrollTop, height: element.clientHeight });
        }
        requestAnimationFrame(() =>
          element
            .querySelector<HTMLButtonElement>(
              `[data-conversation-index="${index}"] button`
            )
            ?.focus({ preventScroll: true })
        );
      }}
    >
      <div style={{ height: offsets[start] }} aria-hidden />
      {rows.slice(start, end).map((row, index) => (
        <MeasuredRow
          key={row.key}
          rowKey={row.key}
          measure={measure}
          index={start + index}
        >
          {'conversation' in row ? (
            renderItem(row.conversation)
          ) : (
            <h3 className="crm-triage-group">
              <span>{row.label}</span>
              <span>{row.count}</span>
            </h3>
          )}
        </MeasuredRow>
      ))}
      <div style={{ height: total - offsets[end] }} aria-hidden />
    </div>
  );
}

function MeasuredRow({
  rowKey,
  measure,
  index,
  children,
}: {
  rowKey: string;
  measure: (key: string, height: number) => void;
  index: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      measure(rowKey, element.getBoundingClientRect().height)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rowKey, measure]);
  return (
    <div ref={ref} data-conversation-index={index} className="flow-root">
      {children}
    </div>
  );
}
