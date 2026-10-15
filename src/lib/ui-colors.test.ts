import { describe, expect, it } from 'vitest';
import {
  pricingTone,
  statusTone,
  statusClasses,
  areaForPath,
} from './ui-colors';
import { getBroadcastStatus, getRecipientStatus } from './broadcast-status';

describe('shared UI color meanings', () => {
  it('keeps communication and outcomes distinct across features', () => {
    expect(statusTone('sent')).toBe('info');
    expect(statusTone('won')).toBe('success');
    expect(statusTone('lost')).toBe('danger');
    expect(getBroadcastStatus('sent').classes).toBe(statusClasses('sent'));
    expect(getRecipientStatus('failed').classes).toBe(statusClasses('failed'));
    expect(statusTone('pending')).toBe(statusTone('expired'));
  });
  it('distinguishes included, chargeable and optional pricing without changing their amounts', () => {
    expect(pricingTone('Included')).toBe('success');
    expect(pricingTone('Optional')).toBe('optional');
    expect(pricingTone('Accessory')).toBe('info');
  });
  it('safely renders unknown or inherited object names as neutral statuses', () => {
    expect(statusTone('future-status')).toBe('neutral');
    expect(statusTone('constructor')).toBe('neutral');
    expect(statusTone('__proto__')).toBe('neutral');
  });
});

it('keeps area identity stable on detail routes and provides a future inventory group', () => {
  expect(areaForPath('/quotations/quote-id')).toBe('documents');
  expect(areaForPath('/contacts/contact-id')).toBe('people');
  expect(areaForPath('/inventory/items/item-id')).toBe(
    areaForPath('/pipelines')
  );
  expect(areaForPath('/flows/flow-id')).toBe('operations');
});
