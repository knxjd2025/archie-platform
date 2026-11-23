import { describe, it, expect } from 'vitest';
import { sanitizePromptText } from '../prompt-sanitize';

describe('sanitizePromptText', () => {
  it('strips ASCII control characters (NUL, BEL, ESC)', () => {
    const dirty = 'safe\x00text\x07with\x1bcontrol';
    const result = sanitizePromptText(dirty);
    expect(result).toBe('safetextwithcontrol');
    // Explicitly assert no control chars remain.
    expect(result).not.toMatch(/[\x00\x07\x1b]/);
  });

  it('strips the DEL character (0x7F)', () => {
    expect(sanitizePromptText('foo\x7fbar')).toBe('foobar');
  });

  it('preserves newlines and tabs', () => {
    const text = 'line1\nline2\tindented';
    expect(sanitizePromptText(text)).toBe('line1\nline2\tindented');
  });

  it('collapses excessive blank lines', () => {
    const text = 'para1\n\n\n\n\npara2';
    const result = sanitizePromptText(text);
    // Should not contain three or more consecutive newlines.
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toBe('para1\n\npara2');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizePromptText('   hello world   ')).toBe('hello world');
  });

  it('caps an over-long string to maxLen', () => {
    const long = 'a'.repeat(5000);
    const result = sanitizePromptText(long, 2000);
    expect(result.length).toBe(2000);
    expect(result).toBe('a'.repeat(2000));
  });

  it('respects a custom maxLen', () => {
    const long = 'b'.repeat(100);
    expect(sanitizePromptText(long, 10).length).toBe(10);
  });

  it('uses a default maxLen of 2000', () => {
    const long = 'c'.repeat(3000);
    expect(sanitizePromptText(long).length).toBe(2000);
  });

  it('leaves ordinary text unchanged', () => {
    const text = 'Per IRC R905.2, asphalt shingles require a 2:12 minimum slope.';
    expect(sanitizePromptText(text)).toBe(text);
  });

  it('returns "" for non-string input', () => {
    expect(sanitizePromptText(undefined as unknown as string)).toBe('');
    expect(sanitizePromptText(null as unknown as string)).toBe('');
    expect(sanitizePromptText(123 as unknown as string)).toBe('');
    expect(sanitizePromptText({} as unknown as string)).toBe('');
  });

  it('returns "" for empty / whitespace-only input', () => {
    expect(sanitizePromptText('')).toBe('');
    expect(sanitizePromptText('    \n\t  ')).toBe('');
  });
});
