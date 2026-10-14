import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import type { Message } from '@/types';
import { MessageActions } from './message-actions';
import { MessageBubble } from './message-bubble';

// The physical message side must not inherit the interface's bidi direction.
// Browser geometry checks cover placement; these pin the component boundaries
// that keep captions, text, and timestamps independent of that placement.
describe.each(['en', 'ar'] as const)('message direction in %s', (locale) => {
  it.each(['customer', 'agent', 'bot'] as const)(
    'isolates %s placement from page direction',
    (sender_type) => {
      const message: Message = {
        id: 'message',
        conversation_id: 'conversation',
        sender_type,
        content_type: 'text',
        content_text: 'مرحباً، تفاصيل الطلب ABC-123',
        created_at: '2026-10-13T09:00:00Z',
        status: 'read',
      };
      const html = renderToStaticMarkup(
        <NextIntlClientProvider
          locale={locale}
          messages={locale === 'ar' ? ar : en}
          timeZone="UTC"
        >
          <section dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            <MessageActions
              message={message}
              onReply={() => {}}
              onReact={() => {}}
            >
              <MessageBubble message={message} authorLabel="Sender" />
            </MessageActions>
          </section>
        </NextIntlClientProvider>
      );
      expect(html).toMatch(/dir="ltr"[^>]*class="crm-message-row/);
      expect(html).toContain(
        sender_type === 'customer' ? 'justify-start' : 'justify-end'
      );
      expect(html).toMatch(/dir="auto" data-direction="(?:incoming|outgoing)"/);
      expect(html).toMatch(/<p dir="auto"/);
      expect(html).toMatch(/dir="ltr" class="crm-message-meta/);
    }
  );
});
