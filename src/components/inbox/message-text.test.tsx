import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MessageText } from './message-text';
import { ReplyQuote } from './reply-quote';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../messages/en.json';

it('isolates phone groups and the plus sign while preserving stored text', () => {
  expect(renderToStaticMarkup(<MessageText text="صاحب البوابة رقم +974 5557 5558" />))
    .toBe('صاحب البوابة رقم <bdi dir="ltr">+974 5557 5558</bdi>');
  expect(renderToStaticMarkup(<MessageText text="رقم ٧٠٠٩٩٨٥٠" />))
    .toBe('رقم <bdi dir="ltr">٧٠٠٩٩٨٥٠</bdi>');
});

it('also isolates numbers in reply previews', () => {
  const html = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={en}><ReplyQuote authorLabel="Ghassan" preview="رقم +974 5557 5558" /></NextIntlClientProvider>);
  expect(html).toContain('<bdi dir="ltr">+974 5557 5558</bdi>');
});
