import { describe, it, expect } from 'vitest';
import { isOptOutKeyword, isOptInKeyword } from './opt-out';

describe('isOptOutKeyword', () => {
  it.each(['stop', 'STOP', ' Stop ', 'unsubscribe', 'cancel', 'end', 'quit'])(
    'matches %j',
    (text) => {
      expect(isOptOutKeyword(text)).toBe(true);
    },
  );

  it('does not match a message that merely contains the keyword', () => {
    expect(isOptOutKeyword('please cancel my order')).toBe(false);
    expect(isOptOutKeyword("I'd like to stop by tomorrow")).toBe(false);
    expect(isOptOutKeyword('this is the end of the road')).toBe(false);
  });

  it('does not match empty or unrelated text', () => {
    expect(isOptOutKeyword('')).toBe(false);
    expect(isOptOutKeyword('   ')).toBe(false);
    expect(isOptOutKeyword('hello there')).toBe(false);
  });

  it('does not match opt-in keywords', () => {
    expect(isOptOutKeyword('start')).toBe(false);
    expect(isOptOutKeyword('unstop')).toBe(false);
  });
});

describe('isOptInKeyword', () => {
  it.each(['start', 'START', ' Start ', 'unstop'])('matches %j', (text) => {
    expect(isOptInKeyword(text)).toBe(true);
  });

  it('does not match a message that merely contains the keyword', () => {
    expect(isOptInKeyword('please start the process')).toBe(false);
  });

  it('does not match opt-out keywords', () => {
    expect(isOptInKeyword('stop')).toBe(false);
  });
});
