import { describe, it, expect } from 'vitest';
import {
  PRECON_CHECKLIST_FIELDS, PRECON_CHECKLIST_SECTIONS,
  preconFieldsComplete, missingRequiredPreconFields,
} from '../preconstruction-checklist';

/** Every required answer filled, so a test can knock out one at a time. */
const complete = () => Object.fromEntries(
  PRECON_CHECKLIST_FIELDS.filter((f) => f.isRequired).map((f) => {
    if (f.type === 'photo') return [f.name, [{ fileId: 'f1', name: 'photo.jpg' }]];
    if (f.type === 'checkbox') return [f.name, true];
    if (f.type === 'option') return [f.name, f.options![0]];
    return [f.name, 'x'];
  }),
);

describe('the pre-construction checklist', () => {
  it('asks about the satellite dish, with somewhere to say there isn\'t one', () => {
    const dish = PRECON_CHECKLIST_FIELDS.find((f) => f.name === 'Satellite dish');
    expect(dish).toBeDefined();
    expect(dish!.options).toEqual(['Stays', 'Goes', 'N/A']);
    expect(dish!.isRequired).toBe(true);
    expect(dish!.section).toBe('Homeowner Conversation');
  });

  it('will not let the checklist be submitted until the dish is answered', () => {
    // Required on purpose: a dish nobody mentioned becomes a decision the crew
    // makes on the roof on the day.
    const answers = complete();
    delete (answers as Record<string, unknown>)['Satellite dish'];
    expect(preconFieldsComplete(answers)).toBe(false);
    expect(missingRequiredPreconFields(answers)).toContain('Satellite dish');
  });

  it('accepts N/A as a real answer, not an empty one', () => {
    expect(preconFieldsComplete({ ...complete(), 'Satellite dish': 'N/A' })).toBe(true);
  });

  it('is complete when every required field is answered', () => {
    expect(preconFieldsComplete(complete())).toBe(true);
    expect(missingRequiredPreconFields(complete())).toEqual([]);
  });

  it('counts an empty photo list and an unticked box as unanswered', () => {
    expect(preconFieldsComplete({ ...complete(), 'Material drop location': [] })).toBe(false);
    expect(preconFieldsComplete({ ...complete(), 'Confirmed crew arrival time': false })).toBe(false);
  });

  it('keeps every field inside a known section, so none renders orphaned', () => {
    for (const f of PRECON_CHECKLIST_FIELDS) expect(PRECON_CHECKLIST_SECTIONS).toContain(f.section);
  });

  it('gives every option field its options', () => {
    for (const f of PRECON_CHECKLIST_FIELDS.filter((x) => x.type === 'option')) {
      expect(f.options?.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate field names — the name is the answer key', () => {
    const names = PRECON_CHECKLIST_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
