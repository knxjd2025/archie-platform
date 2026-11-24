/**
 * A chapter pack is DATA somebody typed, kept for one company. Before it is
 * saved, and again every time it is read back to be shown, it is checked to be
 * exactly the shape it should be and nothing more: plain text in known fields,
 * safe ids, bounded minutes, only the two placeholders. A pack cannot carry a
 * script, a style, a link or an image address because there is no field for
 * one, and an extra field is refused rather than ignored.
 * Fictional company: Summit Ridge Roofing in Cedar Falls.
 */
import { describe, it, expect } from 'vitest';
import { parsePack, packChapterHtml, type ChapterPack, type TenantChapterContext } from '../presentation-chapters';
import { generateScrollPresentationHTML } from '../scroll-presentation-report';
import { makeReport } from './fixtures/report';
import { richBrand, richPack, richReport, scanHtml } from './fixtures/injection';

const good = (): ChapterPack => richPack();
const problemsOf = (v: unknown) => { const r = parsePack(v); return r.ok ? [] : r.problems; };

describe('parsePack', () => {
  it('takes a good pack and gives back a copy holding only the known fields', () => {
    const r = parsePack({ ...good(), sneaky: 1 } as never);
    expect(r.ok).toBe(false); // an extra top-level field is a problem, not ignored
    const ok = parsePack(good());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.pack).toEqual(good());
  });

  it('refuses anything that is not a pack, in plain sentences', () => {
    for (const bad of [null, undefined, 5, 'x', [], { chapters: 'no' }, { chapters: [], mustSay: 'x', mustNotSay: [] }]) {
      const p = problemsOf(bad);
      expect(p.length, JSON.stringify(bad)).toBeGreaterThan(0);
      for (const sentence of p) expect(sentence).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('refuses a field a pack has no place for: a script, a style, a link, an image', () => {
    for (const extra of ['script', 'style', 'href', 'link', 'image', 'imageUrl', 'html', 'onclick', 'src']) {
      const pack = good();
      (pack.chapters[0] as unknown as Record<string, unknown>)[extra] = 'https://elsewhere.example/x';
      expect(problemsOf(pack).join(' '), extra).toContain(`"${extra}"`);
      const step = good();
      step.chapters[0].steps![0] = { ...step.chapters[0].steps![0], [extra]: 'x' } as never;
      expect(problemsOf(step).length, `step ${extra}`).toBeGreaterThan(0);
    }
  });

  it('refuses text that is not plain: markup, or control characters', () => {
    for (const text of ['<script>x</script>', 'a <b>bold</b> word', 'x > y', 'line\u0000break', 'bell\u0007']) {
      const pack = good();
      pack.chapters[0].heading = text;
      expect(problemsOf(pack).length, JSON.stringify(text)).toBeGreaterThan(0);
    }
    const ok = good();
    ok.chapters[0].ledes = ['Two lines.\nOf plain text, with a tab\there.'];
    expect(problemsOf(ok)).toEqual([]);
  });

  it('refuses an id that is not a plain id, and minutes that are not a small whole number', () => {
    for (const id of ['', 'A', '1x', 'x"><img src=x onerror=1>', 'has space', 'a'.repeat(60)]) {
      const pack = good();
      pack.chapters[0].id = id;
      expect(problemsOf(pack).length, id).toBeGreaterThan(0);
    }
    for (const minutes of [-1, 121, 1.5, NaN, Infinity, '2', null, '1</script>'] as unknown[]) {
      const pack = good();
      (pack.chapters[0] as unknown as { minutes: unknown }).minutes = minutes;
      expect(problemsOf(pack).length, String(minutes)).toBeGreaterThan(0);
    }
  });

  it('refuses a placeholder that is not {company} or {phone}', () => {
    const pack = good();
    pack.chapters[0].note = 'Call {owner} on {phone}.';
    expect(problemsOf(pack).join(' ')).toContain('{owner}');
    pack.chapters[0].note = 'Call {company} on {phone}.';
    expect(problemsOf(pack)).toEqual([]);
  });

  it('keeps a pack to a sensible size', () => {
    const many = good();
    many.chapters = Array.from({ length: 25 }, (_, i) => ({ ...good().chapters[0], id: `chapter-${i}`, after: 'condition' }));
    expect(problemsOf(many).length).toBeGreaterThan(0);
    const long = good();
    long.chapters[0].ledes = ['x'.repeat(5000)];
    expect(problemsOf(long).length).toBeGreaterThan(0);
  });

  it('runs the pack\'s own phrase checks and its anchors too, so one call says everything wrong', () => {
    const pack = good();
    pack.mustNotSay = ['everything in writing'];
    pack.chapters[1].after = 'nowhere';
    const p = problemsOf(pack).join(' ');
    expect(p).toContain('everything in writing');
    expect(p).toContain('nowhere');
  });
});

describe('the words of a pack when they are put on a page', () => {
  const ctx = (over: Partial<TenantChapterContext> = {}): TenantChapterContext => ({ n: () => '03', company: 'Summit Ridge Roofing', phone: '(319) 555-0142', hasWork: true, report: makeReport(), ...over });
  const chapter = () => ({ ...good().chapters[0], note: 'A note from {company}. Call {phone}.' });

  it('fills {company} and {phone} from the context handed in, and only those', () => {
    const html = packChapterHtml(ctx(), chapter());
    expect(html).toContain('A note from Summit Ridge Roofing. Call (319) 555-0142.');
  });

  it('escapes the company\'s values too, and reads a $ in a name as just a $', () => {
    const html = packChapterHtml(ctx({ company: 'A$&B <Roofing> "Co" $1', phone: '$`x' }), chapter());
    expect(html).toContain('A$&amp;B &lt;Roofing&gt; &quot;Co&quot; $1');
    expect(html).not.toContain('<Roofing>');
    expect(html).toContain('$`x');
  });

  it('fills a placeholder once: a company name that looks like one is not filled again', () => {
    const html = packChapterHtml(ctx({ company: '{phone}', phone: '555' }), { ...chapter(), note: '{company} / {phone}' });
    expect(html).toContain('{phone} / 555');
  });

  it('escapes every word of the pack', () => {
    const c = chapter();
    c.heading = 'Tom & "Jerry"';
    expect(packChapterHtml(ctx(), c)).toContain('Tom &amp; &quot;Jerry&quot;');
  });

  it('puts nothing of the report\'s own text through the pack\'s placeholders', () => {
    const report = { ...makeReport(), customerName: '{company}' } as never;
    const html = generateScrollPresentationHTML(report, { companyName: 'Summit Ridge Roofing', companyPhone: '(319) 555-0142' }, good());
    expect(html).not.toMatch(/Summit Ridge Roofing Summit Ridge/);
  });
});

describe('a pack read back from storage is checked again before it is shown', () => {
  const brand = richBrand() as never;
  const render = (pack: unknown) => generateScrollPresentationHTML(richReport('full'), brand, pack as ChapterPack);
  const baseline = scanHtml(render(null)).tags.map((t) => t.name).sort();

  it('shows a chapter whose id is plain, and drops one whose id is not, with markup nowhere', () => {
    const pack = good();
    pack.chapters[0].id = 'x"><img src=x onerror=PACKID>';
    const html = render(pack);
    expect(html).not.toContain('onerror=PACKID');
    expect(html).not.toContain('id="ventilation"');
    expect(html).toContain('id="warranty"');
  });

  it('bounds the minutes whatever is stored', () => {
    const pack = good();
    (pack.chapters[0] as unknown as { minutes: unknown }).minutes = 9_999_999;
    const ok = render(pack);
    expect(ok).not.toContain('9999999');
  });

  it('adds no tag, script, style, link or image of its own, whatever extra properties it carries', () => {
    const pack = good();
    for (const ch of pack.chapters) {
      Object.assign(ch, { script: 'EXTRA_SCRIPT', style: 'EXTRA_STYLE', href: 'https://elsewhere.example/', image: 'https://elsewhere.example/i.png', html: '<b>EXTRA_HTML</b>' });
    }
    const html = render(pack);
    for (const mark of ['EXTRA_SCRIPT', 'EXTRA_STYLE', 'EXTRA_HTML', 'elsewhere.example']) expect(html).not.toContain(mark);
    const tags = scanHtml(html).tags;
    // The pack's own chapters add text, headings, paragraphs and lists, and the rail gets a link to each chapter on the same
    // page (an address that is only `#id`); never a script, style, outside link, image or frame.
    const baseCount = (n: string) => baseline.filter((x) => x === n).length;
    for (const n of ['script', 'style', 'link', 'img', 'iframe', 'object', 'embed', 'form', 'meta', 'base']) {
      expect(tags.filter((t) => t.name === n).length, n).toBe(baseCount(n));
    }
    const outside = tags.filter((t) => t.name === 'a' && t.attrs.some((a) => a.name === 'href' && !a.value.startsWith('#')));
    const baseOutside = scanHtml(render(null)).tags.filter((t) => t.name === 'a' && t.attrs.some((a) => a.name === 'href' && !a.value.startsWith('#')));
    expect(outside.length).toBe(baseOutside.length);
  });
});
