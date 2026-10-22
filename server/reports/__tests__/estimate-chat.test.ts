import { describe, it, expect } from 'vitest';
import { parseChatEdit } from '../estimate-chat';

describe('parseChatEdit', () => {
  it('reads a clean reply', () => {
    const out = parseChatEdit('{"lines":[{"name":"Chimney flashing","quantity":1,"unit":"ea","unitPrice":850}],"summary":"Added chimney flashing."}')!;
    expect(out.lines).toEqual([{ name: 'Chimney flashing', quantity: 1, unit: 'ea', unitPrice: 850 }]);
    expect(out.summary).toBe('Added chimney flashing.');
  });

  it('survives code fences and preamble', () => {
    // Chat models wrap JSON in fences and chatter constantly; refusing those
    // would make the feature fail at random.
    const raw = 'Sure! Here you go:\n```json\n{"lines":[{"name":"X","quantity":2,"unit":"sq","unitPrice":100}],"summary":"ok"}\n```\nHope that helps.';
    expect(parseChatEdit(raw)!.lines).toHaveLength(1);
  });

  it('defaults quantity and unit when the model omits them', () => {
    const out = parseChatEdit('{"lines":[{"name":"Service call","unitPrice":125}],"summary":"s"}')!;
    expect(out.lines[0].quantity).toBe(1);
    expect(out.lines[0].unit).toBe('ea');
  });

  it('keeps a zero price rather than discarding the line', () => {
    // "Add haul-away, no charge" is a real instruction.
    expect(parseChatEdit('{"lines":[{"name":"Haul away","unitPrice":0}],"summary":"s"}')!.lines).toHaveLength(1);
  });

  it('drops lines that would poison the total', () => {
    const out = parseChatEdit('{"lines":[{"name":"Good","unitPrice":100},{"name":"","unitPrice":5},{"name":"NaN price","unitPrice":"abc"},{"name":"Negative","unitPrice":-10}],"summary":"s"}')!;
    expect(out.lines.map((l) => l.name)).toEqual(['Good']);
  });

  it('accepts an empty list — clearing the estimate is a real edit', () => {
    expect(parseChatEdit('{"lines":[],"summary":"Cleared it."}')!.lines).toEqual([]);
  });

  it('returns null when there is no usable JSON', () => {
    // Better to tell the rep it did not understand than to silently wipe the
    // estimate to zero lines.
    for (const raw of ['', 'I am not sure what you mean.', '{ broken', '{"summary":"no lines here"}']) {
      expect(parseChatEdit(raw), raw).toBeNull();
    }
  });

  it('has a fallback summary rather than an empty label', () => {
    expect(parseChatEdit('{"lines":[{"name":"X","unitPrice":1}]}')!.summary).toBe('Updated the estimate.');
  });
});
