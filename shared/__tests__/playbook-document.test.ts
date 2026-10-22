import { describe, it, expect } from 'vitest';
import { PLAYBOOK, fillTemplate, playbookDoc } from '../playbook';
import { checklistTotal, inlineHtml, parsePlaybookText, renderPlaybookDocument, renderPlaybookPrintPage } from '../playbook-document';

const ctx = { repName: 'Casey Rep', repTitle: 'Sales Consultant', repCell: '(704) 555-0100', repEmail: 'casey@bestroofingnow.com', customerName: 'Pat Homeowner', customerLabel: 'Pat Homeowner' };
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) || []);

describe('parsePlaybookText', () => {
  it('keeps the words of every document in the library', () => {
    for (const d of PLAYBOOK) {
      const blocks = parsePlaybookText(d.body, { title: d.title, kind: d.kind });
      expect(blocks.length, d.title).toBeGreaterThan(0);
      const got = words(JSON.stringify(blocks) + d.title);
      const src = [...words(d.body)];
      const missing = src.filter((w) => !got.has(w));
      // Only repeated PDF blocks and video URLs (shown as buttons) may drop words.
      expect(missing.length / Math.max(1, src.length), `${d.title}: ${missing.join(', ')}`).toBeLessThan(0.08);
    }
  });

  it('finds headings, nested bullets, notes, script alternatives and letter sign-offs', () => {
    const blocks = parsePlaybookText([
      'Sorry I Missed You!', '', 'NOTE: Leave this at the door.', '', 'WHAT YOU GET', '• First thing', '  ○ Sub point', '• Second thing',
      '', 'Hi, my name is Casey.', '-------', 'Hello there, I am Casey.', '', 'Regards,', '', 'NAME', 'TITLE', 'PHONE',
    ].join('\n'), { kind: 'letter', signature: 'Casey Rep\nSales Consultant, Best Roofing Now' });
    expect(blocks.map((b) => b.t)).toEqual(['title', 'callout', 'h2', 'list', 'p', 'rule', 'p', 'signoff']);
    const list = blocks[3] as any;
    expect(list.items.map((it: any) => [it.text, it.depth])).toEqual([['First thing', 0], ['Sub point', 1], ['Second thing', 0]]);
    expect((blocks[7] as any).lines).toEqual(['Casey Rep', 'Sales Consultant, Best Roofing Now']);
  });

  it('joins PDF-wrapped checklist items and numbers the tick boxes', () => {
    const blocks = parsePlaybookText('☐ Email or text Getting Reviews Templates for\nEmail/Text\n☐ Canvass using the SLAP\nCanvassing Formula letting people know.\n☐ Done.', { kind: 'checklist' });
    const list = blocks.find((b) => b.t === 'list') as any;
    expect(list.items.map((it: any) => [it.text, it.n])).toEqual([
      ['Email or text Getting Reviews Templates for Email/Text', 0], ['Canvass using the SLAP Canvassing Formula letting people know.', 1], ['Done.', 2],
    ]);
  });

  it('drops a block run the PDF export repeated', () => {
    const blocks = parsePlaybookText('Objections\n\nEXAMPLE 1\n\n“My roof is fine, thank you very much.”\n\n○ They don’t trust me?\n\nEXAMPLE 1\n\n“My roof is fine, thank you very much.”\n\n○ They don’t trust me?');
    expect(blocks.filter((b) => b.t === 'list')).toHaveLength(1);
  });

  it('counts every checklist tick box', () => {
    for (const d of PLAYBOOK.filter((x) => x.kind === 'checklist')) {
      expect(checklistTotal(d)).toBe((d.body.match(/^\s*☐/gm) || []).length);
    }
  });
});

describe('rendering', () => {
  it('escapes everything a rep or customer record can contain', () => {
    expect(inlineHtml('<img src=x onerror=alert(1)> [NAME] https://x.com/"a', 'screen')).not.toMatch(/<img|"a/);
    const html = renderPlaybookDocument(PLAYBOOK.find((d) => d.kind === 'letter')!, { mode: 'screen', ctx: { ...ctx, repName: '<script>x</script>' } });
    expect(html).not.toContain('<script>');
  });

  it('brands letters with a letterhead, emails with a header, and internal documents as the Sales Playbook', () => {
    const letter = PLAYBOOK.find((d) => d.kind === 'letter')!;
    const lh = renderPlaybookDocument(letter, { mode: 'screen', text: fillTemplate(letter.body, ctx).text, ctx });
    expect(lh).toContain('pbd-letterhead');
    expect(lh).toContain('CertainTeed ShingleMaster');
    expect(lh).not.toContain(letter.title); // the internal title never prints on a customer letter
    const guide = PLAYBOOK.find((d) => d.kind === 'guide')!;
    expect(renderPlaybookDocument(guide, { mode: 'screen' })).toContain('Sales Playbook');
    const page = renderPlaybookPrintPage(guide, { logoUrl: 'https://app.example/logo.jpg' });
    expect(page).toContain('@page');
    expect(page).toContain('https://app.example/logo.jpg');
  });

  it('writes email HTML with inline styles only', () => {
    const email = playbookDoc(PLAYBOOK.find((d) => d.kind === 'email')!.id)!;
    const html = renderPlaybookDocument(email, { mode: 'email', text: fillTemplate(email.body, ctx).text, ctx, logoUrl: 'https://app.example/logo.jpg' });
    expect(html).not.toMatch(/class="/);
    expect(html).not.toMatch(/^Subject:/m);
    expect(html).toContain('Casey Rep');
    expect(html).toContain('style="');
  });

  it('shows ticked boxes as done', () => {
    const d = PLAYBOOK.find((x) => x.kind === 'checklist' && checklistTotal(x) > 1)!;
    const html = renderPlaybookDocument(d, { mode: 'screen', checked: new Set([0]) });
    expect(html.match(/is-done/g)).toHaveLength(1);
    expect(html).toContain('data-check="1"');
  });
});

describe('every document in every mode', () => {
  it('renders without classes in email and with the brand everywhere', () => {
    for (const d of PLAYBOOK) {
      const text = fillTemplate(d.body, ctx).text;
      expect(renderPlaybookDocument(d, { mode: 'email', text, ctx }), d.title).not.toMatch(/class="/);
      expect(renderPlaybookDocument(d, { mode: 'screen', text, ctx }), d.title).toContain('Best Roofing Now');
    }
  });
});

describe('letters', () => {
  it('keeps rep instructions off the printed letter but shows them on screen', () => {
    const d = PLAYBOOK.find((x) => x.title.startsWith('Wind Damage'))!;
    const text = fillTemplate(d.body, ctx).text;
    const printed = renderPlaybookDocument(d, { mode: 'print', text, ctx });
    expect(printed).not.toMatch(/Starts on Page 2|Watch these videos/);
    expect(printed).toContain('Dear Homeowner');
    expect(printed).toMatch(/pbd-title[^>]*>I drove by your house/);
    expect(renderPlaybookDocument(d, { mode: 'screen', text, ctx })).toContain('Starts on Page 2');
  });
  it('leaves a letter without instructions whole', () => {
    const d = PLAYBOOK.find((x) => x.title.startsWith('Door Hanger: Sorry'))!;
    expect(renderPlaybookDocument(d, { mode: 'print' })).toContain('Sorry I Missed You!');
  });
});
