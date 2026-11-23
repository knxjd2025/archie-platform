/**
 * Tests for the standard presentation renderer and the style routing that picks it.
 *
 * The presentation is a customer-facing page carrying tenant-supplied data, so
 * the tests that matter most are the escaping ones, the ones that prove a
 * chapter only appears when the report has the data for it, and the one that
 * proves the price is held back to near the end rather than led with.
 */
import { describe, it, expect } from 'vitest';
import {
  generateScrollPresentationHTML,
  canRenderPresentation,
  presentationChapters,
  presentationMinutes,
  MIN_PRESENTATION_CHAPTERS,
} from '../scroll-presentation-report';
import { packProblems, packChapterHtml, chaptersToRender, type ChapterPack } from '../presentation-chapters';
import { resolveVisualStyle } from '../report-templates';
import { renderReportHtml } from '../render-report-html';
import type { AnalyzedPhoto, ComprehensiveRoofReport } from '../comprehensive-roof-report';
import { makeReport as baseReport } from './fixtures/report';

/** The markup we authored, with the inlined engine script excluded. */
function bodyMarkup(html: string): string {
  return html.slice(html.indexOf('<body'), html.indexOf('<script>'));
}

function photo(over: Partial<AnalyzedPhoto> = {}): AnalyzedPhoto {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    url: 'https://cdn.example.com/roof.jpg',
    damages: [],
    overallSeverity: 'none',
    aiSummary: '',
    analyzedAt: '2026-09-05T00:00:00.000Z',
    ...over,
  } as AnalyzedPhoto;
}

function makeReport(over: Partial<ComprehensiveRoofReport> = {}): ComprehensiveRoofReport {
  const base = baseReport();
  return {
    ...base,
    customerName: 'Dana Whitfield',
    damageAnalysis: {
      ...base.damageAnalysis,
      totalPhotosAnalyzed: 6,
      photosWithDamage: 2,
      overallSeverity: 'medium',
      aiSummary: 'Localised damage on the rear slope.',
      roofAge: {
        estimatedAgeYears: 14,
        expectedLifespanYears: 25,
        remainingLifeYears: 8,
        confidence: 'medium',
        indicators: ['granule loss', 'sealant fatigue'],
        roofMaterial: 'architectural asphalt',
        materialCondition: 'fair',
      },
      photos: [
        photo({ id: 'p1', photoCategory: 'overview' }),
        photo({ id: 'p2', photoCategory: 'roof_surface' }),
        photo({
          id: 'p3',
          photoCategory: 'vent',
          overallSeverity: 'high',
          damages: [
            { type: 'pipe_boot_failure', label: 'Pipe boot failure', severity: 'high', location: 'Rear slope', confidence: 0.9 },
          ] as never,
        }),
        photo({ id: 'p4', photoCategory: 'closeup' }),
      ],
    },
    repairEstimate: { ...base.repairEstimate, total: 4250, subtotal: 3800, lineItems: [], notes: [] },
    ...over,
  } as ComprehensiveRoofReport;
}

const chapterIds = (r: ComprehensiveRoofReport): string[] =>
  presentationChapters(r).map((c) => c.id);

describe('presentationChapters', () => {
  it('opens on the property and closes on the next step', () => {
    const ids = chapterIds(makeReport());
    expect(ids[0]).toBe('property');
    expect(ids[ids.length - 1]).toBe('next');
  });

  it('holds the price back to second from the end', () => {
    const ids = chapterIds(makeReport());
    expect(ids).toContain('estimate');
    expect(ids.indexOf('estimate')).toBe(ids.length - 2);
    // and it is well past the middle, not led with
    expect(ids.indexOf('estimate') / ids.length).toBeGreaterThan(0.6);
  });

  it('drops the estimate chapter when there is nothing to price', () => {
    const r = makeReport({ repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] } as never });
    expect(chapterIds(r)).not.toContain('estimate');
  });

  it('drops the storm chapter when no events were recorded', () => {
    const r = makeReport({ stormHistory: { ...makeReport().stormHistory, totalEvents: 0 } as never });
    expect(chapterIds(r)).not.toContain('storm');
  });

  it('drops the measurement chapter when the roof was never measured', () => {
    expect(chapterIds(makeReport({ measurementReport: undefined }))).not.toContain('measured');
  });

  it('adds the measurement chapter when a takeoff exists', () => {
    const r = makeReport({
      measurementReport: {
        segments: [],
        totalFootprintSqFt: 2400,
        totalAdjustedSqFt: 2760,
        totalSquares: 27.6,
        averagePitch: '6/12',
        wastePercentage: 15,
        edgeLengths: { ridge: 62, hip: 0, valley: 34, eave: 140, rake: 88, dripEdge: 228, flashing: 40 },
        materialTakeoff: {},
        dataSource: 'eagleview',
      } as never,
    });
    expect(chapterIds(r)).toContain('measured');
    // 27.6 squares is presented rounded, and the counter needs a "from to" pair.
    expect(generateScrollPresentationHTML(r)).toContain('data-sc-count="0 28"');
  });

  it('drops the evidence rail below three usable photographs', () => {
    const r = makeReport();
    r.damageAnalysis.photos = r.damageAnalysis.photos.slice(0, 2);
    expect(chapterIds(r)).not.toContain('evidence');
  });

  it('numbers chapters against the set that actually rendered', () => {
    // With no measurement chapter the one after it must still be numbered 03.
    const html = generateScrollPresentationHTML(makeReport({ measurementReport: undefined }));
    const ids = chapterIds(makeReport({ measurementReport: undefined }));
    const third = ids[2];
    expect(html).toContain(`<b>03</b>`);
    expect(html).toContain(`id="${third}"`);
  });

  it('adds up a presenting time that matches the chapters', () => {
    const r = makeReport();
    const summed = presentationChapters(r).reduce((a, c) => a + c.minutes, 0);
    expect(presentationMinutes(r)).toBe(summed);
    expect(summed).toBeGreaterThan(0);
  });
});

describe('canRenderPresentation', () => {
  it('is true for a report with real content', () => {
    expect(canRenderPresentation(makeReport())).toBe(true);
  });

  it('is false for a report too thin to fill chapters', () => {
    const thin = {
      ...makeReport(),
      damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], photos: [], aiSummary: '' },
      repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
      stormHistory: { ...makeReport().stormHistory, totalEvents: 0 },
      roofConditionIndex: undefined,
      measurementReport: undefined,
      structuredFindings: [],
    } as unknown as ComprehensiveRoofReport;
    expect(presentationChapters(thin).length).toBeLessThan(MIN_PRESENTATION_CHAPTERS);
    expect(canRenderPresentation(thin)).toBe(false);
  });
});

describe('generateScrollPresentationHTML', () => {
  it('renders a complete standalone document with the engine inlined', () => {
    const html = generateScrollPresentationHTML(makeReport());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('ScrollCraft.mount');
    expect(html).toContain('</html>');
  });

  it('puts a chapter rail with a running clock on the page', () => {
    const html = generateScrollPresentationHTML(makeReport());
    expect(html).toContain('id="railNow"');
    expect(html).toContain('class="rail__clock"');
    expect(html).toMatch(/of \d+ &middot; about \d+ min/);
  });

  it('gives every pan act the trailing spacer the engine needs', () => {
    // Count in our own markup only: the inlined engine stylesheet carries
    // [data-sc-act="pan"] selectors of its own.
    const body = bodyMarkup(generateScrollPresentationHTML(makeReport()));
    const pans = (body.match(/data-sc-act="pan"/g) || []).length;
    const ends = (body.match(/class="rail2__end"/g) || []).length;
    expect(pans).toBeGreaterThan(0);
    expect(ends).toBe(pans);
  });

  it('never lets a scrim carry data-sc-copy', () => {
    const body = bodyMarkup(generateScrollPresentationHTML(makeReport()));
    const scrims = body.match(/<div class="scrimplate[^>]*>/g) || [];
    expect(scrims.length).toBeGreaterThan(0);
    for (const s of scrims) expect(s).not.toContain('data-sc-copy');
  });

  it('escapes tenant and customer data', () => {
    const html = generateScrollPresentationHTML(
      makeReport({ customerName: '<script>alert(1)</script>' }),
      { companyName: '"><img src=x onerror=alert(1)>' },
    );
    // Escaped text still contains the characters; what must not survive is any
    // of it landing as markup.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('refuses a brand colour that is not a hex value', () => {
    const html = generateScrollPresentationHTML(makeReport(), {
      brandPrimaryColor: 'red;} body{display:none}',
    });
    expect(html).not.toContain('display:none}');
    expect(html).toContain('--sc-accent:#EA580C');
  });

  it('uses the company brand colour when it is a real hex', () => {
    const html = generateScrollPresentationHTML(makeReport(), { brandPrimaryColor: '#0057B8' });
    expect(html).toContain('--sc-accent:#0057B8');
  });

  it('strips non-dialable characters out of the phone href', () => {
    const html = generateScrollPresentationHTML(makeReport(), { companyPhone: '(319) 555-0147' });
    expect(html).toContain('href="tel:3195550147"');
  });

  it('says so plainly when nothing needs doing', () => {
    const html = generateScrollPresentationHTML(
      makeReport({
        repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] } as never,
        damageAnalysis: { ...makeReport().damageAnalysis, overallSeverity: 'none' } as never,
      }),
    );
    expect(html).toContain('Nothing needs doing today.');
  });

  it('puts a finding’s evidence photographs inside the finding', () => {
    const r = makeReport({
      structuredFindings: [
        {
          id: 'f1',
          title: 'Pipe boot failure, rear slope',
          severity: 'high',
          narrative: 'The rubber collar has split.',
          relatedPhotoIds: ['p3'],
          repairAction: 'Replace the boot.',
          insuranceRelevant: true,
        },
      ] as never,
    });
    const html = generateScrollPresentationHTML(r);
    const card = html.slice(html.indexOf('class="find"'), html.indexOf('</article>'));
    expect(card).toContain('find__ev');
    expect(card).toContain('Replace the boot.');
  });

  it('never prints an AI confidence rating on the customer page', () => {
    const html = generateScrollPresentationHTML(
      makeReport({
        structuredFindings: [
          { id: 'f1', title: 'Creasing', severity: 'moderate', narrative: 'n', relatedPhotoIds: [], repairAction: 'r', insuranceRelevant: false },
        ] as never,
      }),
    );
    expect(html.toLowerCase()).not.toContain('confidence');
  });
});

describe('renderReportHtml routing', () => {
  it('renders the presentation for the presentation style', async () => {
    const out = await renderReportHtml(makeReport({ reportVisualStyle: 'presentation' }));
    expect(out.style).toBe('presentation');
    expect(out.html).toContain('id="railNow"');
    expect(out.downgradeReason).toBeUndefined();
  });

  it('falls back to the document when the report is too thin to present', async () => {
    const thin = {
      ...makeReport({ reportVisualStyle: 'presentation' }),
      damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], photos: [], aiSummary: '' },
      repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
      stormHistory: { ...makeReport().stormHistory, totalEvents: 0 },
      roofConditionIndex: undefined,
      measurementReport: undefined,
      structuredFindings: [],
    } as unknown as ComprehensiveRoofReport;
    const out = await renderReportHtml(thin);
    expect(out.style).toBe('formal');
    expect(out.downgradeReason).toMatch(/presentation needs at least/i);
  });

  it('still renders a document for the formal style', async () => {
    const out = await renderReportHtml(makeReport({ reportVisualStyle: 'formal' }));
    expect(out.style).toBe('formal');
    expect(out.html).not.toContain('id="railNow"');
  });

  it('honours the caller fallback when the report carries no style', async () => {
    const r = makeReport();
    delete (r as { reportVisualStyle?: unknown }).reportVisualStyle;
    const out = await renderReportHtml(r, {}, { styleFallback: 'presentation' });
    expect(out.style).toBe('presentation');
  });

  it('resolves presentation as a real style', () => {
    expect(resolveVisualStyle('full', 'presentation')).toBe('presentation');
  });
});

// ── a company's own chapters, handed in as data ─────────────────────────────

const SUMMIT = {
  companyName: 'Summit Ridge Roofing',
  companyEmail: 'office@summitridge.example',
  companyWebsite: 'https://summitridge.example',
  companyPhone: '(319) 555-0142',
};

/** A fictional pack: two chapters after `age` (the second is process, so only with work) and a questions chapter anchored to the first. */
const PACK: ChapterPack = {
  chapters: [
    {
      id: 'sr-ventilation',
      label: 'Ventilation',
      minutes: 3,
      after: 'age',
      onlyWithWork: false,
      heading: 'A roof that cannot breathe wears out early.',
      ledes: ['Warm, damp air has to leave the attic, or it works on the roof from underneath.'],
      steps: [
        { title: 'Heat', text: 'Trapped heat ages the shingle from the back.' },
        { title: 'Damp', text: 'Moisture settles on cold wood in winter.' },
      ],
      note: 'We check intake as well as exhaust.',
    },
    {
      id: 'sr-process',
      label: 'How the job runs',
      minutes: 2,
      after: 'sr-ventilation',
      onlyWithWork: true,
      heading: 'One crew, one plan, one clean yard.',
      ledes: ['{company} protects your property before the first shingle moves.'],
    },
    {
      id: 'sr-questions',
      label: 'Questions we get',
      minutes: 2,
      after: 'sr-process',
      onlyWithWork: false,
      heading: 'Questions people ask.',
      ledes: ['Short answers.'],
      questions: [
        { q: 'Who do I call?', a: 'Call {phone} and you reach the office.' },
        { q: 'Is it messy?', a: 'We clean up every day.' },
      ],
    },
  ],
  mustSay: ['breathe'],
  mustNotSay: ['guarantee for life'],
};

const noWorkReport = () => ({
  ...makeReport(),
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
}) as unknown as ComprehensiveRoofReport;

const ids = (r: ComprehensiveRoofReport, pack: ChapterPack | null) =>
  presentationChapters(r, SUMMIT, pack).map((c) => c.id);

describe('chapter packs as input', () => {
  it('a company with no pack gets exactly the base chapter set', () => {
    const base = presentationChapters(makeReport(), SUMMIT).map((c) => c.id);
    expect(ids(makeReport(), null)).toEqual(base);
    expect(base.some((id) => id.startsWith('sr-'))).toBe(false);
  });

  it('splices the pack in after its anchors, with the price still held back', () => {
    const got = ids(makeReport(), PACK);
    expect(got.indexOf('sr-ventilation')).toBe(got.indexOf('age') + 1);
    expect(got.indexOf('sr-process')).toBe(got.indexOf('sr-ventilation') + 1);
    expect(got.indexOf('sr-questions')).toBe(got.indexOf('sr-process') + 1);
    expect(got.indexOf('estimate')).toBeGreaterThan(got.indexOf('sr-questions'));
    expect(got[got.length - 1]).toBe('next');
  });

  it('a no-work report shows only the chapters that are not onlyWithWork', () => {
    const got = ids(noWorkReport(), PACK);
    expect(got).toContain('sr-ventilation');
    expect(got).toContain('sr-questions');
    expect(got).not.toContain('sr-process');
  });

  it('when the first anchor is dropped the questions chapter still follows the nearest earlier chapter that rendered', () => {
    const pack: ChapterPack = {
      ...PACK,
      chapters: [
        { ...PACK.chapters[1], after: 'age' }, // onlyWithWork, anchored to age
        { ...PACK.chapters[2], after: 'sr-process' },
      ],
    };
    const got = ids(noWorkReport(), pack);
    expect(got).not.toContain('sr-process');
    expect(got.indexOf('sr-questions')).toBe(got.indexOf('age') + 1);
  });

  it('numbers pack chapters into the same running sequence', () => {
    const chapters = presentationChapters(makeReport(), SUMMIT, PACK);
    const html = generateScrollPresentationHTML(makeReport(), SUMMIT, PACK);
    expect(html).toContain(`of ${chapters.length} &middot;`);
    expect(html).toContain(`<b>${String(chapters.length).padStart(2, '0')}</b>`);
  });

  it('renderReportHtml passes the pack to the presentation and to nothing else', async () => {
    const out = await renderReportHtml(makeReport({ reportVisualStyle: 'presentation' }), SUMMIT, { pack: PACK });
    expect(out.html).toContain('A roof that cannot breathe wears out early.');
    const plain = await renderReportHtml(makeReport({ reportVisualStyle: 'presentation' }), SUMMIT);
    expect(plain.html).not.toContain('A roof that cannot breathe');
  });

  it('writes the company name and phone in through the placeholders, escaped', () => {
    const html = generateScrollPresentationHTML(makeReport(), { ...SUMMIT, companyName: 'Ridge <b>& Co' }, PACK);
    expect(html).toContain('Ridge &lt;b&gt;&amp; Co protects your property');
    expect(html).toContain('Call (319) 555-0142 and you reach the office.');
  });

  it('escapes every value a pack carries', () => {
    const evil: ChapterPack = {
      mustSay: [],
      mustNotSay: [],
      chapters: [
        {
          id: 'evil',
          label: '<i>l</i>',
          minutes: 1,
          after: 'age',
          onlyWithWork: false,
          heading: '<script>alert(1)</script>',
          ledes: ['<img src=x onerror=alert(1)>'],
          steps: [{ title: '<u>t</u>', text: '<u>x</u>' }],
          questions: [{ q: '<s>q</s>', a: '<s>a</s>' }],
          note: '<marquee>n</marquee>',
        },
      ],
    };
    const html = generateScrollPresentationHTML(makeReport(), SUMMIT, evil);
    const body = bodyMarkup(html);
    for (const raw of ['<script>alert(1)', '<img src=x', '<u>t', '<s>q', '<marquee>', '<i>l</i>']) {
      expect(body).not.toContain(raw);
    }
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('chaptersToRender and packChapterHtml are plain functions of their input', () => {
    const c = { n: () => '07', company: 'X', phone: '', hasWork: false, report: makeReport() };
    expect(chaptersToRender(null, c)).toEqual([]);
    expect(chaptersToRender(PACK, c).map((x) => x.id)).toEqual(['sr-ventilation', 'sr-questions']);
    expect(packChapterHtml(c, PACK.chapters[0])).toContain('<b>07</b>');
    expect(packChapterHtml(c, PACK.chapters[2])).toContain('the number on this page');
  });
});

describe('packProblems', () => {
  it('is empty for a good pack', () => {
    expect(packProblems(PACK)).toEqual([]);
  });

  it('names a mustNotSay phrase found in a chapter', () => {
    const bad: ChapterPack = {
      ...PACK,
      chapters: [{ ...PACK.chapters[0], note: 'It is a Guarantee For Life.' }, ...PACK.chapters.slice(1)],
    };
    expect(packProblems(bad)).toEqual(['The pack says "guarantee for life", which it must not say.']);
  });

  it('names a mustSay phrase that is missing', () => {
    expect(packProblems({ ...PACK, mustSay: ['ten year workmanship'] })).toEqual([
      'The pack never says "ten year workmanship", which it must say.',
    ]);
  });

  it('names an unknown anchor, a bad id, a repeated id and a standard id', () => {
    const c = PACK.chapters[0];
    const bad: ChapterPack = {
      ...PACK,
      chapters: [
        { ...c, id: 'Bad Id' },
        { ...c, id: 'estimate' },
        { ...c, id: 'one', after: 'nowhere' },
        { ...c, id: 'one' },
      ],
    };
    const out = packProblems(bad).join('\n');
    expect(out).toContain('"Bad Id" is not allowed');
    expect(out).toContain('"estimate" is already used by a standard chapter');
    expect(out).toContain('follows "nowhere"');
    expect(out).toContain('"one" is used more than once');
  });

  it('refuses an anchor that points forward to a later pack chapter', () => {
    const [a, b] = [PACK.chapters[0], PACK.chapters[1]];
    expect(packProblems({ ...PACK, chapters: [{ ...a, after: 'sr-process' }, b] }).join(' ')).toContain('follows "sr-process"');
  });
});
