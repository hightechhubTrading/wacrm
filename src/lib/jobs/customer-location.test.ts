import { describe, expect, it } from 'vitest';
import { customerLocation } from './customer-location';

const message = {
  sender_type: 'customer',
  content_type: 'text',
  content_text: '',
};
describe('customer location prefill', () => {
  it('retains the customer pin label and coordinates', () => {
    expect(
      customerLocation({
        ...message,
        content_type: 'location',
        content_text: 'Villa entrance\nhttps://www.google.com/maps?q=25.2,51.5',
      })
    ).toBe('Villa entrance — https://www.google.com/maps?q=25.2,51.5');
  });
  it('accepts a shared map link inside customer text', () => {
    expect(
      customerLocation({
        ...message,
        content_text: 'هذا موقعي https://maps.app.goo.gl/example،',
      })
    ).toBe('https://maps.app.goo.gl/example');
  });
  it.each([
    'https://maps.app.goo.gl.attacker.example/pin',
    'https://example.com/maps',
    'https://www.google.com/search?q=Doha',
    'Al Aziziyah',
    'https://user:password@maps.apple.com/?q=Doha',
  ])('does not treat %s as a trusted location', (content_text) => {
    expect(customerLocation({ ...message, content_text })).toBeNull();
  });
  it('does not prefill an agent-sent location or an AI image description', () => {
    expect(
      customerLocation({
        ...message,
        sender_type: 'agent',
        content_text: 'https://maps.app.goo.gl/example',
      })
    ).toBeNull();
    expect(
      customerLocation({
        ...message,
        content_type: 'image',
        content_text: 'https://maps.app.goo.gl/example',
      })
    ).toBeNull();
  });
});
