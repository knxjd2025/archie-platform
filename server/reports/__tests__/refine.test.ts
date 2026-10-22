import { describe, it, expect } from 'vitest';
import { applyReportPatch, parseRefineResponse, buildEditableSurface, appendTurns, transcriptForPrompt, MAX_TURNS } from '../refine';

const sample = () => ({
  title: 'Roof Inspection',
  executiveSummary: 'Long original summary.',
  inspectorNotes: 'Original notes.',
  damageAnalysis: {
    aiSummary: 'Analyzed 8 photos.',
    totalPhotosAnalyzed: 8,
    photos: [
      {
        id: 'photo-0', url: 'https://x/1.jpg', caption: 'South slope',
        damages: [{ id: 'damage-0-0', type: 'missing_shingles', label: 'Missing shingles', severity: 'high', description: 'Two tabs gone.' }],
      },
    ],
  },
  repairEstimate: { subtotalFinal: 4200, lineItems: [{ id: 'a', total: 4200 }] },
  stormHistory: { totalEvents: 20, hailEvents: 1 },
});

describe('applyReportPatch', () => {
  it('applies prose edits and reports what changed', () => {
    const r = applyReportPatch(sample(), {
      executiveSummary: 'Shorter summary.',
      findings: { 'damage-0-0': { description: 'Two tabs missing on the south slope.' } },
      photoCaptions: { 'photo-0': 'North slope' },
    });
    // Both keys land on the paragraph the report actually prints.
    expect(r.data.damageAnalysis.aiSummary).toBe('Shorter summary.');
    expect(r.data.damageAnalysis.photos[0].damages[0].description).toBe('Two tabs missing on the south slope.');
    expect(r.data.damageAnalysis.photos[0].caption).toBe('North slope');
    expect(r.changes).toHaveLength(3);
  });

  it('never lets a patch reach money, severity, or storm data', () => {
    // The whole safety argument for this feature rests on this test.
    const before = sample();
    const r = applyReportPatch(before, {
      executiveSummary: 'New summary.',
      // Everything below is off-limits and must be ignored even if the model emits it.
      repairEstimate: { subtotalFinal: 99999 },
      stormHistory: { totalEvents: 0 },
      findings: { 'damage-0-0': { severity: 'low', type: 'granule_loss' } },
      damageAnalysis: { totalPhotosAnalyzed: 0 },
    } as any);

    expect(r.data.repairEstimate.subtotalFinal).toBe(4200);
    expect(r.data.stormHistory.totalEvents).toBe(20);
    expect(r.data.damageAnalysis.totalPhotosAnalyzed).toBe(8);
    expect(r.data.damageAnalysis.photos[0].damages[0].severity).toBe('high');
    expect(r.data.damageAnalysis.photos[0].damages[0].type).toBe('missing_shingles');
  });

  it('does not mutate the original report', () => {
    const before = sample();
    applyReportPatch(before, { executiveSummary: 'Changed.' });
    expect(before.damageAnalysis.aiSummary).toBe('Analyzed 8 photos.');
  });

  it('ignores blank values and unknown ids', () => {
    const r = applyReportPatch(sample(), {
      executiveSummary: '   ',
      aiSummary: '',
      findings: { 'no-such-id': { label: 'Ghost' } },
      photoCaptions: { 'no-such-photo': 'Nope' },
    });
    expect(r.data.damageAnalysis.aiSummary).toBe('Analyzed 8 photos.');
    expect(r.changes).toEqual([]);
  });

  it('reports no changes when the patch matches what is already there', () => {
    const r = applyReportPatch(sample(), { executiveSummary: 'Analyzed 8 photos.' });
    expect(r.changes).toEqual([]);
  });

  it('sends an executiveSummary edit to the paragraph the report renders', () => {
    // The renderer prints damageAnalysis.aiSummary under its "Executive Summary"
    // heading and ignores a top-level executiveSummary entirely, so writing the
    // top-level field reported success while the document stayed identical.
    const r = applyReportPatch(sample(), { executiveSummary: 'Two plain sentences.' });
    expect(r.data.damageAnalysis.aiSummary).toBe('Two plain sentences.');
    expect(r.changes).toEqual(['executive summary']);
  });

  it('accepts aiSummary as an alias for the same paragraph', () => {
    const r = applyReportPatch(sample(), { aiSummary: 'Alias worked.' });
    expect(r.data.damageAnalysis.aiSummary).toBe('Alias worked.');
  });
});

describe('parseRefineResponse', () => {
  it('reads a plain JSON reply', () => {
    const r = parseRefineResponse('{"reply":"Shortened it.","patch":{"executiveSummary":"Short."}}');
    expect(r.reply).toBe('Shortened it.');
    expect(r.patch.executiveSummary).toBe('Short.');
  });

  it('reads JSON wrapped in a markdown fence or prose', () => {
    const r = parseRefineResponse('Sure!\n```json\n{"reply":"Done.","patch":{"title":"New"}}\n```\n');
    expect(r.patch.title).toBe('New');
  });

  it('changes nothing when the reply is not usable JSON', () => {
    // Half-applying a mangled patch to a customer document is worse than no edit.
    const r = parseRefineResponse('I think you should reconsider the roof.');
    expect(r.patch).toEqual({});
    expect(r.reply).toContain('reconsider');
  });
});

describe('buildEditableSurface', () => {
  it('exposes editable prose and marks severity read-only', () => {
    const s = buildEditableSurface(sample());
    // Labelled the way a rep would say it, not by its internal field name.
    expect(s).toContain('executiveSummary:');
    expect(s).not.toContain('aiSummary:');
    expect(s).toContain('finding[damage-0-0]');
    expect(s).toContain('read-only');
  });

  it('never exposes pricing to the editor', () => {
    expect(buildEditableSurface(sample())).not.toContain('4200');
  });

  it('handles a report with nothing editable', () => {
    expect(buildEditableSurface({})).toContain('nothing editable');
  });
});

describe('transcript', () => {
  it('appends turns and caps the history', () => {
    let data: any = sample();
    for (let i = 0; i < MAX_TURNS + 10; i++) {
      data = appendTurns(data, [{ role: 'user', text: `msg ${i}`, at: '2026-09-06T00:00:00Z' }]);
    }
    expect(data.refinementChat).toHaveLength(MAX_TURNS);
    expect(data.refinementChat.at(-1).text).toBe(`msg ${MAX_TURNS + 9}`);
  });

  it('renders recent turns for the prompt', () => {
    const data = appendTurns(sample(), [
      { role: 'user', text: 'Shorten it', at: 'x' },
      { role: 'assistant', text: 'Done', at: 'y' },
    ]);
    const t = transcriptForPrompt(data);
    expect(t).toBe('Rep: Shorten it\nYou: Done');
  });
});
