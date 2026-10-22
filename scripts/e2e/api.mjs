// End-to-end API run against the local server (throwaway DB, forged sessions).
// Every step records PASS/FAIL with the evidence; nothing here hits a real service.
import fs from 'node:fs';
import { startScanStandIn } from './scan-standin.mjs';
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3999';

// The vision provider's stand-in (scan-standin.mjs); the server is pointed at it by run.sh.
const { calls: scanCalls } = await startScanStandIn();
const cookies = JSON.parse(fs.readFileSync(process.env.E2E_COOKIES, 'utf8'));
const results = [];
const T = (name, ok, evidence = '') => { results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 220) }); return ok; };

async function api(who, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.cookie = cookies[who];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, ctype: r.headers.get('content-type') || '' };
}
const today = new Date().toISOString().slice(0, 10);

function fillRequired(fields, over = {}) {
  const a = {};
  for (const f of fields) {
    if (f.isReviewerField || !f.isRequired) continue;
    if (over[f.name] !== undefined) { a[f.name] = over[f.name]; continue; }
    switch (f.type) {
      case 'option': a[f.name] = f.options?.[0] ?? 'Yes'; break;
      case 'number': a[f.name] = 25; break;
      case 'date': a[f.name] = today; break;
      case 'signature': a[f.name] = 'E2E Rep'; break;
      default: a[f.name] = `e2e ${f.name.toLowerCase()}`;
    }
  }
  return { ...a, ...over };
}

// ---------------------------------------------------------------- auth ----
{
  const anon = await api(null, 'GET', '/api/auth/me');
  T('auth: anonymous is rejected', anon.status === 401, anon.status);
  const me = await api('rep', 'GET', '/api/auth/me');
  T('auth: forged rep session resolves', me.json?.user?.email === 'e2e-rep@bestroofingnow.com', JSON.stringify(me.json));
  const adm = await api('admin', 'GET', '/api/auth/me');
  T('auth: admin session resolves', adm.json?.user?.role === 'admin', JSON.stringify(adm.json));
}

// -------------------------------------------------------------- scoping ----
{
  const rep = await api('rep', 'GET', '/api/leads?limit=50');
  const ids = (rep.json?.leads || []).map((l) => l.externalId);
  T('scope: rep sees own jobs', ids.includes('e2e-res-1') && ids.includes('e2e-com-1'), ids.join(','));
  T('scope: rep does not see another rep\'s job', !ids.includes('e2e-other-1'), ids.join(','));
  const adm = await api('admin', 'GET', '/api/leads?limit=50');
  const aids = (adm.json?.leads || []).map((l) => l.externalId);
  T('scope: admin sees every job', ['e2e-res-1', 'e2e-com-1', 'e2e-other-1'].every((i) => aids.includes(i)), aids.join(','));
  const other = await api('rep', 'GET', '/api/clients/e2e-other-1');
  T('scope: rep opening another rep\'s client gets 404', other.status === 404, other.status);
  const own = await api('rep', 'GET', '/api/clients/e2e-com-1');
  const ownName = own.json?.lead?.customer ?? own.json?.firstName;
  T('scope: rep opens own client', own.status === 200 && ownName === 'Warehouse LLC', own.status + ' ' + JSON.stringify(own.json).slice(0, 100));
}

// ------------------------------------------------ residential inspection ----
let resInspectionId;
{
  const f = await api('rep', 'GET', '/api/inspections/fields?kind=residential');
  T('inspection: residential fields load', f.json?.kind === 'residential' && f.json.fields?.length > 20, `${f.json?.kind} ${f.json?.fields?.length}`);
  const create = await api('rep', 'POST', '/api/inspections', { jobExternalId: 'e2e-res-1', formKind: 'residential', answers: { 'Inspector Name': 'E2E Rep' } });
  resInspectionId = create.json?.submission?.id;
  T('inspection: residential draft created', create.status === 200 && resInspectionId > 0 && create.json.submission.answers.__formKind === 'residential', JSON.stringify(create.json).slice(0, 160));
  const early = await api('rep', 'POST', `/api/inspections/${resInspectionId}/submit`);
  T('inspection: submit with gaps is refused and names them', early.status === 400 && Array.isArray(early.json?.missing) && early.json.missing.length > 3, `${early.status} missing=${early.json?.missing?.length}`);
  const answers = fillRequired(f.json.fields, { 'Inspector Name': 'E2E Rep', 'Inspection Date': today, 'Overall damage summary': 'Hail bruising on the south and west slopes; two lifted shingles at the ridge; pipe boots cracked.', 'Inspector Signature': 'E2E Rep' });
  const patch = await api('rep', 'PATCH', `/api/inspections/${resInspectionId}`, { answers });
  T('inspection: answers saved', patch.status === 200, patch.status + ' ' + (patch.json?.error || ''));
  const submit = await api('rep', 'POST', `/api/inspections/${resInspectionId}/submit`);
  T('inspection: residential submitted', submit.json?.submission?.status === 'submitted' && submit.json.submission.signedAt, JSON.stringify(submit.json).slice(0, 160));
  const forbidden = await api('rep', 'PATCH', `/api/inspections/${resInspectionId}/review`, { recommendation: 'Full replacement' });
  T('inspection: a rep cannot review', forbidden.status === 403, forbidden.status);
  const review = await api('admin', 'PATCH', `/api/inspections/${resInspectionId}/review`, { recommendation: 'Full replacement' });
  T('inspection: admin review recorded', review.json?.submission?.status === 'reviewed' && review.json.submission.recommendation === 'Full replacement', JSON.stringify(review.json).slice(0, 160));
  const cross = await api('rep', 'POST', '/api/inspections', { jobExternalId: 'e2e-other-1', formKind: 'residential', answers: {} });
  T('inspection: rep cannot open a checklist on another rep\'s job', cross.status === 404, cross.status);
}

// ------------------------------------------------- commercial inspection ----
let comInspectionId;
{
  const f = await api('rep', 'GET', '/api/inspections/fields?kind=commercial');
  T('commercial: checklist fields load', f.json?.kind === 'commercial' && f.json.fields?.some((x) => x.name === 'Membrane type'), `${f.json?.kind} ${f.json?.fields?.length}`);
  const create = await api('rep', 'POST', '/api/inspections', { jobExternalId: 'e2e-com-1', formKind: 'commercial', answers: { 'Inspector Name': 'E2E Rep' } });
  comInspectionId = create.json?.submission?.id;
  T('commercial: draft created with kind inside answers', create.json?.submission?.answers?.__formKind === 'commercial', JSON.stringify(create.json).slice(0, 160));
  const answers = fillRequired(f.json.fields, {
    'Inspector Name': 'E2E Rep', 'Inspection Date': today, 'Inspector Signature': 'E2E Rep',
    'Building type / use': 'Warehouse / Industrial', 'Roof area (sq ft)': 24000, 'Roof slope': '1/4:12',
    'Deck type': 'Steel (metal deck)', 'Deck condition': 'Good', 'Insulation type': 'Polyiso', 'Insulation thickness (in)': 2,
    'Membrane type': 'TPO', 'Membrane thickness / plies': '45 mil', 'Membrane attachment': 'Mechanically attached',
    'Number of roof systems in place': '1', 'Estimated age of current roof (years)': 17, 'Core cut taken': 'Yes',
    'Core cut findings': '45 mil TPO over 2 in polyiso, dry at the cut, steel deck',
    'Membrane field condition': 'Poor', 'Seams and laps': 'Poor', 'Penetrations (pipes, pitch pockets, conduits)': 'Failed',
    'Ponding observed': 'Moderate — 1/4 to 1 in, or slow to drain', 'Ponding locations and approximate area': 'NE corner near RTU-3, about 300 sq ft',
    'Number of roof drains': 6, 'Moisture survey performed': 'Infrared (IR) scan', 'Estimated wet insulation (% of roof area)': 0,
    'Active leaks reported by the owner': 'Yes', 'Interior evidence': 'Two ceiling stains under RTU-3',
    'Overall condition summary': 'A 17-year-old mechanically attached TPO roof with failing seams and pitch pockets; dry insulation, one system in place.',
    'Fall protection present': 'None', 'Full photo package complete': 'Yes',
  });
  const patch = await api('rep', 'PATCH', `/api/inspections/${comInspectionId}`, { answers });
  const submit = await api('rep', 'POST', `/api/inspections/${comInspectionId}/submit`);
  T('commercial: submitted', patch.status === 200 && submit.json?.submission?.status === 'submitted', `${patch.status} ${submit.status} ${JSON.stringify(submit.json?.missing || submit.json?.error || '')}`);
  const review = await api('admin', 'PATCH', `/api/inspections/${comInspectionId}/review`, { recommendation: 'Recover (new membrane over the existing roof)' });
  T('commercial: reviewed', review.json?.submission?.status === 'reviewed', review.status);
  const ctx = await api('rep', 'GET', '/api/clients/e2e-com-1/report-context');
  T('commercial: report context says the checklist was commercial', ctx.json?.estimateDefaults?.formKind === 'commercial' && ctx.json.estimateDefaults.squares === 240, JSON.stringify(ctx.json?.estimateDefaults));
  const rctx = await api('rep', 'GET', '/api/clients/e2e-res-1/report-context');
  T('residential: report context defaults to replacement after the review', rctx.json?.estimateDefaults?.mode === 'replacement' && rctx.json.estimateDefaults.formKind === 'residential', JSON.stringify(rctx.json?.estimateDefaults));
}

// --------------------------------------------------------------- reports ----
const reports = {};
async function generate(key, who, externalId, body) {
  const r = await api(who, 'POST', `/api/clients/${externalId}/reports/generate`, body);
  if (r.status !== 200 || r.json?.status !== 'succeeded') { T(`report: ${key} generated`, false, `${r.status} ${JSON.stringify(r.json).slice(0, 180)}`); return null; }
  const st = await api(who, 'GET', `/api/reports/${r.json.id}`);
  T(`report: ${key} generated`, st.json?.status === 'succeeded' && st.json.reportUrl === `/r/${r.json.id}`, `${r.json.id} ${st.json?.status}`);
  const html = await fetch(BASE + `/r/${r.json.id}`); // public share link, no cookie
  const text = await html.text();
  reports[key] = { id: r.json.id, html: text, externalId };
  T(`report: ${key} share link serves HTML without a session`, html.status === 200 && /<html/i.test(text), `${html.status} ${text.length} bytes`);
  return reports[key];
}
{
  const prod = await api('rep', 'GET', '/api/reports/roofing-products');
  const com = await api('rep', 'GET', '/api/reports/commercial-products');
  T('products: residential and commercial catalogs load', Array.isArray(prod.json?.products ?? prod.json) && (JSON.stringify(com.json).includes('dura_last')), `${JSON.stringify(prod.json).slice(0, 80)} | ${JSON.stringify(com.json).slice(0, 80)}`);

  const resTiers = { tierSelection: { good: 'landmark', better: 'landmark_pro', best: 'landmark_premium' }, squares: 30, selectedTier: 'better' };
  const comTiers = { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, squares: 240, selectedTier: 'better', isoTier: 'r25' };

  const bad = await api('rep', 'POST', '/api/clients/e2e-res-1/reports/generate', { reportType: 'proposal', squares: 30 });
  T('report: proposal without tiers is refused', bad.status === 400, `${bad.status} ${bad.json?.error}`);

  const ri = await generate('residential inspection', 'rep', 'e2e-res-1', { reportType: 'inspection', includeJobFiles: false });
  if (ri) T('report: residential inspection reads as residential', /Roof Inspection|Inspection Report/i.test(ri.html) && !/Commercial Roof Condition/.test(ri.html), ri.html.match(/<title>[^<]*/)?.[0]);
  const re = await generate('residential estimate (replacement)', 'rep', 'e2e-res-1', { reportType: 'estimate', estimateMode: 'replacement', includeJobFiles: false, ...resTiers });
  if (re) T('report: residential estimate carries financing and the tiers', /Financing/.test(re.html) && /Landmark/.test(re.html), re.html.match(/<title>[^<]*/)?.[0]);
  const rp = await generate('residential proposal', 'rep', 'e2e-res-1', { reportType: 'proposal', includeJobFiles: false, ...resTiers });
  if (rp) T('report: residential proposal is the homeowner deck', /One decision left, Pat\./.test(rp.html) && /treat your home/.test(rp.html), rp.html.match(/<title>[^<]*/)?.[0]);
  const rpr = await generate('residential presentation', 'rep', 'e2e-res-1', { reportType: 'presentation', includeJobFiles: false, ...resTiers });
  if (rpr) T('report: residential presentation has ventilation + options + investment', /Attic Ventilation|Ventilation/.test(rpr.html) && /opt-card/.test(rpr.html) && /inv-total-count/.test(rpr.html) && /followTier/.test(rpr.html), rpr.html.match(/<title>[^<]*/)?.[0]);

  const ci = await generate('commercial inspection', 'rep', 'e2e-com-1', { reportType: 'inspection', includeJobFiles: false });
  if (ci) T('report: commercial condition report shows the assembly + condition matrix', /Commercial Roof Condition Report/.test(ci.html) && /cf-layer--mem/.test(ci.html) && /cf-rating--failed/.test(ci.html) && !/1511/.test(ci.html), ci.html.match(/<title>[^<]*/)?.[0]);
  const ce = await generate('commercial estimate (replacement)', 'rep', 'e2e-com-1', { reportType: 'estimate', estimateMode: 'replacement', includeJobFiles: false, ...comTiers });
  if (ce) T('report: commercial estimate has no consumer financing, shows the existing roof', !/<h2>Financing<\/h2>/.test(ce.html) && /The Existing Roof/.test(ce.html) && /Duro-Last/.test(ce.html), ce.html.match(/<title>[^<]*/)?.[0]);
  const cp = await generate('commercial proposal', 'rep', 'e2e-com-1', { reportType: 'proposal', includeJobFiles: false, ...comTiers });
  if (cp) T('report: commercial proposal speaks to the building owner', /Commercial Roofing Proposal/.test(cp.html) && /One decision left, Warehouse LLC\./.test(cp.html) && /treat your building/.test(cp.html) && !/your home/.test(cp.html), cp.html.match(/<title>[^<]*/)?.[0]);
  const cpr = await generate('commercial presentation', 'rep', 'e2e-com-1', { reportType: 'presentation', includeJobFiles: false, ...comTiers });
  if (cpr) T('report: commercial presentation is the commercial deck', /Commercial Roof Presentation/.test(cpr.html) && /Restore, Recover, or Replace/.test(cpr.html) && /Questions Building Owners Ask/.test(cpr.html) && !/PowerPay|HFS Financial|hfsfinancial|your home|old shingles/.test(cpr.html) && /glideTo/.test(cpr.html), cpr.html.match(/<title>[^<]*/)?.[0]);

  // scope lines on a proposal (catalog item, rep price ignored): the first
  // Perma-Boot is $450 and each after it $200, so four are $450 + $600.
  const sp = await generate('residential proposal with scope', 'rep', 'e2e-res-1', { reportType: 'proposal', includeJobFiles: false, ...resTiers, scopeItems: [{ catalogId: 'perma_boot', quantity: 4, unitPrice: 1 }] });
  if (sp) T('report: scope line priced from the catalog, rep override ignored', /Perma-Boot/.test(sp.html) && /data-scope-grand-total/.test(sp.html) && /\$450\.00/.test(sp.html) && /\$600\.00/.test(sp.html) && !/\$4\.00/.test(sp.html), (sp.html.match(/scope-table[\s\S]{0,400}/)?.[0] || '').replace(/\s+/g, ' ').slice(0, 200));

  // list + cross-rep visibility
  const list = await api('rep', 'GET', '/api/clients/e2e-com-1/reports');
  T('report: client report list shows the four commercial documents', (list.json?.reports || list.json || []).length >= 4, JSON.stringify(list.json).slice(0, 160));
  const cross = await api('rep', 'GET', '/api/clients/e2e-other-1/reports');
  T('report: another rep\'s report list is hidden', cross.status === 404 || (Array.isArray(cross.json?.reports) && cross.json.reports.length === 0), cross.status);
}

// ---------------------------------------------------------------- editor ----
{
  const r = reports['commercial presentation'];
  if (r) {
    const ed = await api('rep', 'GET', `/api/clients/${r.externalId}/reports/${r.id}/editor`);
    const keys = (ed.json?.sections || []).map((s) => s.key);
    T('editor: commercial presentation lists its chapters', keys.slice(0, 6).join(',') === 'welcome,summary,roof-today,condition,water,fix', keys.join(','));
    const draft = { title: 'E2E Commercial Deck', layout: { order: [...keys].reverse(), hidden: ['faq'] } };
    const pv = await api('rep', 'POST', `/api/clients/${r.externalId}/reports/${r.id}/preview`, { draft });
    T('editor: preview re-renders with the draft applied', pv.status === 200 && /E2E Commercial Deck|<main/.test(pv.json?.html || '') && Array.isArray(pv.json?.sections), `${pv.status} changes=${JSON.stringify(pv.json?.changes)} ${pv.json?.error || ''}`);
    const save = await api('rep', 'PUT', `/api/clients/${r.externalId}/reports/${r.id}/draft`, { draft });
    T('editor: draft committed', save.status === 200, `${save.status} ${JSON.stringify(save.json).slice(0, 120)}`);
    const after = await fetch(BASE + `/r/${r.id}`).then((x) => x.text());
    T('editor: the share link now serves the edited document (reordered, FAQ hidden)', after.indexOf('id="ch-next"') > 0 && after.indexOf('id="ch-next"') < after.indexOf('id="ch-welcome"') && !/id="ch-faq"/.test(after), `next@${after.indexOf('id="ch-next"')} welcome@${after.indexOf('id="ch-welcome"')} faq=${/id="ch-faq"/.test(after)}`);
    // The fallback is the singular "Building Owner"; the deck's own chapter
    // "Why Building Owners Choose Us" is not a lost name.
    T('editor: an edited deck still addresses the customer by name', /Warehouse LLC/.test(after) && !/Building Owner(?!s)|One decision left, there\./.test(after), (after.match(/title-name[^>]*>([^<]*)</)||['',''])[1] + ' | ' + (after.match(/One decision left, [^<]*/)||[''])[0]);
    const cross = await api('admin', 'GET', `/api/clients/${r.externalId}/reports/${r.id}/editor`);
    T('editor: admin can open the same editor', cross.status === 200, cross.status);
  }
  const est = reports['commercial estimate (replacement)'];
  if (est) {
    const g = await api('rep', 'GET', `/api/clients/${est.externalId}/reports/${est.id}/estimate`);
    T('estimate editor: loads line items', g.status === 200 && Array.isArray(g.json?.lines) && g.json.lines.some((l) => /Duro-Last/.test(l.name)), `${g.status} ${JSON.stringify(g.json).slice(0, 120)}`);
  }
}

// ------------------------------------- commercial: scan, pricing, editing ----
{
  const comTiers = { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, squares: 240, selectedTier: 'better', isoTier: 'r25' };
  const shots = ['https://photos.example.com/north-seam.jpg', 'https://photos.example.com/drain-2.jpg', 'https://photos.example.com/unreadable.jpg'];
  const chapters = (html) => (html.slice(html.indexOf('<main')).match(/<section[^>]*\bid="ch-/g) || []).length;
  const COI = 'Our Certificate of Insurance (COI) and our W-9 are provided to you before any work starts';
  const PERMITS = 'every permit is pulled before the start of work';

  // The Inspection: photos scanned, options and pricing asked for.
  const raw = await api('rep', 'POST', '/api/clients/e2e-com-1/reports/generate', { reportType: 'inspection', includeJobFiles: false, photos: shots, includePricing: true, ...comTiers });
  T('scan: the inspection reads each picked photo once and reports the one it could not read', raw.status === 200 && raw.json?.analyzedPhotos === 2 && /2 of 3/.test(raw.json?.warning || '') && shots.every((u) => scanCalls.filter((c) => c === u).length === 1), `${raw.status} analysed=${raw.json?.analyzedPhotos} warning=${raw.json?.warning} calls=${scanCalls.length}`);
  const insp = raw.json?.id ? await fetch(BASE + `/r/${raw.json.id}`).then((x) => x.text()) : '';
  T('scan: the inspection sorts and describes the photos beside the inspector rating', /3 photos, 2 read and described/.test(insp) && /class="ev-doc"/.test(insp) && /The lap is open at the centre of the frame\./.test(insp) && /Inspector's rating for seams and laps: <b>/.test(insp) && /drafted with AI assistance/.test(insp), insp.match(/\d+ photos?, [^<]*/)?.[0]);
  T('inspection: asked for pricing, it carries the options, what is included and the commitments', />Your Options<\/h2>/.test(insp) && /better &middot; Quoted/.test(insp) && />What Is Included<\/h2>/.test(insp) && insp.includes(COI) && insp.includes(PERMITS), (insp.match(/tier__price">[^<]*/g) || []).join(' '));
  T('inspection: the layer diagram draws the quoted systems and is scroll-driven', /What Happens to Each Layer/.test(insp) && (insp.match(/<div class="asm" data-asm /g) || []).length === 3 && /Duro-Last/.test(insp) && /setProperty\('--sc-p'/.test(insp), (insp.match(/data-asm-pick="[a-z]+"/g) || []).join(' '));
  const plain = reports['commercial inspection']?.html || '';
  T('inspection: not asked for pricing, it carries no price and shows the three paths', !/>Your Options<\/h2>/.test(plain) && /What Happens to Each Layer/.test(plain) && /To be confirmed|What the inspection calls for/.test(plain), plain.match(/asm-chip[^>]*><span>[^<]*/)?.[0]);

  // A Proposal straight after reuses the Inspection's scan: same findings, no second read.
  const before = scanCalls.length;
  const cp = await generate('commercial proposal (after scan)', 'rep', 'e2e-com-1', { reportType: 'proposal', includeJobFiles: false, photos: shots, ...comTiers });
  if (cp) {
    T('scan: a proposal after the inspection reuses its scan instead of reading the photos again', scanCalls.length === before && /The lap is open at the centre of the frame\./.test(cp.html), `calls ${before} -> ${scanCalls.length}`);
    T('proposal: live layer diagram, ten chapters or more, and the commitments word for word', /id="ch-layers"/.test(cp.html) && /data-sc-act="pin"/.test(cp.html) && chapters(cp.html) >= 10 && cp.html.includes(COI) && cp.html.includes(PERMITS) && /Company Information/.test(cp.html) && /The Inspection Record/.test(cp.html), `chapters=${chapters(cp.html)}`);

    const ed = await api('rep', 'GET', `/api/clients/e2e-com-1/reports/${cp.id}/editor`);
    const com = ed.json?.commercial;
    const keys = (ed.json?.sections || []).map((s) => s.key);
    T('editor: a commercial proposal opens with its commercial tools', com?.minChapters === 10 && com.assembly?.layers?.length > 0 && com.photoScan?.scanned === 2 && (ed.json?.sections || []).filter((s) => s.required).length === 4 && ed.json.findings?.length >= 2, JSON.stringify({ min: com?.minChapters, layers: com?.assembly?.layers?.length, scan: com?.photoScan, findings: ed.json?.findings?.length }).slice(0, 200));
    const residentialEd = reports['residential proposal'] ? await api('rep', 'GET', `/api/clients/e2e-res-1/reports/${reports['residential proposal'].id}/editor`) : null;
    T('editor: a residential proposal has no commercial tools', residentialEd?.status === 200 && residentialEd.json?.commercial == null, residentialEd?.status);

    const finding = ed.json?.findings?.find((f) => f.label === 'Open seam');
    const draft = {
      commercialSummary: 'E2E summary written by the rep.',
      sectionNotes: { water: 'E2E note: two drains added at the NE corner.' },
      customSections: [{ id: 'e2ephase', title: 'E2E Phasing Plan', body: '## Week one\n- North half first' }],
      beforeStartTerms: ['E2E term: site walk the week before.'],
      assembly: { layers: { 't-membrane': { label: 'E2E membrane wording' } }, note: 'E2E core cut note.' },
      findings: finding ? { [finding.id]: { description: 'E2E edited finding text.' } } : {},
    };
    const pv = await api('rep', 'POST', `/api/clients/e2e-com-1/reports/${cp.id}/preview`, { draft });
    T('editor: the preview applies every commercial edit', pv.status === 200 && (pv.json?.changes || []).length === 6 && (pv.json?.invisible || []).length === 0, `${pv.status} ${JSON.stringify(pv.json?.changes)} ${pv.json?.error || ''}`);
    const save = await api('rep', 'PUT', `/api/clients/e2e-com-1/reports/${cp.id}/draft`, { draft });
    const after = await fetch(BASE + `/r/${cp.id}`).then((x) => x.text());
    T('editor: saved, the share link carries the summary, note, chapter, term, diagram wording and finding', save.status === 200 && ['E2E summary written by the rep.', 'E2E Phasing Plan', 'E2E term: site walk the week before.', 'E2E membrane wording', 'E2E core cut note.', 'E2E edited finding text.'].every((x) => after.includes(x)), `${save.status} ${JSON.stringify(save.json).slice(0, 140)}`);
    // Then try to hide the whole document.
    await api('rep', 'PUT', `/api/clients/e2e-com-1/reports/${cp.id}/draft`, { draft: { layout: { hidden: keys } } });
    const trimmed = await fetch(BASE + `/r/${cp.id}`).then((x) => x.text());
    T('editor: hiding every chapter still leaves ten, with the required four and the commitments', chapters(trimmed) === 10 && ['ch-roof-today', 'ch-company', 'ch-product', 'ch-before-start'].every((id) => trimmed.includes(`id="${id}"`)) && trimmed.includes(COI) && trimmed.includes(PERMITS), `chapters=${chapters(trimmed)}`);
  }

  // A different set of picked photos is read fresh rather than handed the old scan.
  const again = scanCalls.length;
  const cpr = await api('rep', 'POST', '/api/clients/e2e-com-1/reports/generate', { reportType: 'presentation', includeJobFiles: false, photos: ['https://photos.example.com/west-seam.jpg'], analyzePhotoUrls: ['https://photos.example.com/west-seam.jpg'], ...comTiers });
  T('scan: a presentation with a different photo pick reads the new photo', cpr.status === 200 && scanCalls.length === again + 1 && cpr.json?.analyzedPhotos === 1 && !cpr.json?.warning, `${cpr.status} calls ${again} -> ${scanCalls.length} analysed=${cpr.json?.analyzedPhotos} ${cpr.json?.warning || ''}`);

  // And a residential job never reaches the scan at all.
  const resBefore = scanCalls.length;
  await api('rep', 'POST', '/api/clients/e2e-res-1/reports/generate', { reportType: 'inspection', includeJobFiles: false, photos: shots });
  T('scan: a residential inspection never scans a photo', scanCalls.length === resBefore, `calls ${resBefore} -> ${scanCalls.length}`);
}

// ------------------------------------------------------ present + engage ----
{
  const r = reports['commercial presentation'];
  if (r) {
    const p1 = await api('rep', 'POST', `/api/clients/${r.externalId}/reports/${r.id}/present`);
    const p2 = await api('rep', 'POST', `/api/clients/${r.externalId}/reports/${r.id}/present`);
    T('present: first call stamps, second is idempotent', p1.json?.ok && p1.json.presentedBy === 'e2e-rep@bestroofingnow.com' && p2.json?.presentedAt === p1.json.presentedAt, JSON.stringify(p1.json) + ' / ' + JSON.stringify(p2.json));
    const tr = await fetch(BASE + `/r/${r.id}/track`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open', seconds: 12 }) });
    T('engagement: public track endpoint accepts a view', tr.status < 500, tr.status);
    const bogus = await fetch(BASE + '/r/not-a-real-token');
    T('share: unknown token is a 404', bogus.status === 404, bogus.status);
  }
}

// ---------------------------------------------------------------- delete ----
{
  const r = await generate('throwaway inspection', 'rep', 'e2e-res-1', { reportType: 'inspection', includeJobFiles: false, photos: ['https://photos.example.com/west-seam.jpg'] });
  if (r) {
    const wrongJob = await api('rep', 'DELETE', `/api/clients/e2e-com-1/reports/${r.id}`);
    T('delete: a report id paired with another job is a 404', wrongJob.status === 404, wrongJob.status);
    const del = await api('rep', 'DELETE', `/api/clients/${r.externalId}/reports/${r.id}`);
    T('delete: the owner can delete a finished report', del.status === 200 && del.json?.ok === true, `${del.status} ${JSON.stringify(del.json)}`);
    const link = await fetch(BASE + `/r/${r.id}`);
    T('delete: its share link is gone', link.status === 404, link.status);
    const list = await api('rep', 'GET', `/api/clients/${r.externalId}/reports`);
    T('delete: it is gone from the job', Array.isArray(list.json?.reports) && !list.json.reports.some((x) => x.reportId === r.id), list.json?.reports?.length);
    const again = await api('rep', 'DELETE', `/api/clients/${r.externalId}/reports/${r.id}`);
    T('delete: deleting it twice is a 404', again.status === 404, again.status);
  }
}

// ------------------------------------------------------- final walkthrough ----
{
  const f = await api('rep', 'GET', '/api/final-walkthrough/fields');
  const fields = f.json?.fields || [];
  T('walkthrough: fields load', fields.length > 30, fields.length);
  const create = await api('rep', 'POST', '/api/final-walkthrough', { jobExternalId: 'e2e-res-1', answers: { 'Walked by': 'E2E Rep' } });
  const id = create.json?.walkthrough?.id;
  T('walkthrough: draft created', create.status === 200 && id > 0, JSON.stringify(create.json).slice(0, 120));
  const early = await api('rep', 'POST', `/api/final-walkthrough/${id}/submit`);
  T('walkthrough: submit with gaps refused', early.status === 400 && early.json?.missing?.length > 10, `${early.status} missing=${early.json?.missing?.length}`);
  const answers = {};
  for (const fl of fields) {
    if (fl.type === 'verify') answers[fl.name] = { state: 'ok' };
    else if (fl.type === 'photo') answers[fl.name] = ['https://example.com/e2e.jpg'];
    else if (fl.type === 'checkbox') answers[fl.name] = true;
    else if (fl.type === 'option') answers[fl.name] = fl.options[0];
    else if (fl.type === 'date') answers[fl.name] = today;
    else answers[fl.name] = 'E2E Rep';
  }
  answers['Homeowner present'] = 'No';
  answers['Gutters and downspouts — no dents, loose hangers or knocked-out alignment'] = { state: 'issue' }; // issue without a note
  const p1 = await api('rep', 'PATCH', `/api/final-walkthrough/${id}`, { answers });
  const s1 = await api('rep', 'POST', `/api/final-walkthrough/${id}/submit`);
  T('walkthrough: an Issue without a note blocks submit', p1.status === 200 && s1.status === 400 && (s1.json?.missing || []).some((m) => /Gutters and downspouts — no dents/.test(m)), `${s1.status} ${JSON.stringify(s1.json?.missing)}`);
  answers['Gutters and downspouts — no dents, loose hangers or knocked-out alignment'] = { state: 'issue', note: 'Downspout at the NE corner dented by the ladder.' };
  await api('rep', 'PATCH', `/api/final-walkthrough/${id}`, { answers });
  const s2 = await api('rep', 'POST', `/api/final-walkthrough/${id}/submit`);
  T('walkthrough: submitted with one issue → one follow-up', s2.json?.walkthrough?.status === 'submitted' && s2.json.walkthrough.issueCount === 1 && s2.json.followUps === 1, JSON.stringify(s2.json).slice(0, 160));
  const s3 = await api('rep', 'POST', `/api/final-walkthrough/${id}/submit`);
  T('walkthrough: resubmit is idempotent', s3.json?.followUps === 0 && s3.json?.walkthrough?.status === 'submitted', JSON.stringify(s3.json).slice(0, 100));
  const pm = await api('pm', 'POST', '/api/final-walkthrough', { jobExternalId: 'e2e-other-1', answers: { 'Walked by': 'E2E PM' } });
  T('walkthrough: production role may walk any job', pm.status === 200, `${pm.status} ${pm.json?.error || ''}`);
  const repCross = await api('rep', 'POST', '/api/final-walkthrough', { jobExternalId: 'e2e-other-1', answers: {} });
  T('walkthrough: rep cannot walk another rep\'s job', repCross.status === 404, repCross.status);
  const fu = await api('rep', 'GET', '/api/follow-ups');
  const mine = (fu.json?.followUps || fu.json || []).filter?.((x) => /Final walkthrough/.test(x.note)) || [];
  const newest = mine.reduce((m, x) => (x.id > (m?.id ?? -1) ? x : m), null);
  T('walkthrough: its follow-ups carry the client name', !!newest && newest.clientName === 'Pat Jones', JSON.stringify(newest).slice(0, 160));
  const list = await api('pm', 'GET', '/api/final-walkthrough?jobExternalId=e2e-res-1');
  T('walkthrough: PM sees the rep\'s walkthrough', (list.json?.walkthroughs || list.json || []).some?.((w) => w.id === id) || JSON.stringify(list.json).includes(`"id":${id}`), JSON.stringify(list.json).slice(0, 120));
}

// -------------------------------------------------------- production board ----
{
  const adm = await api('admin', 'GET', '/api/production');
  const jobs = adm.json?.jobs || [];
  const res = jobs.find((j) => j.externalId === 'e2e-res-1');
  const com = jobs.find((j) => j.externalId === 'e2e-com-1');
  T('production: board lists the jobs by stage', res?.pipeline?.stage === 'install' && com?.pipeline?.stage === 'schedule', JSON.stringify({ res: res?.pipeline?.stage, com: com?.pipeline?.stage, n: jobs.length }));
  T('production: card carries the walkthrough status', res?.walkthrough?.state === 'issues' && res.walkthrough.issueCount === 1 && res.walkthrough.submittedAt, JSON.stringify(res?.walkthrough));
  const rep = await api('rep', 'GET', '/api/production');
  const rids = (rep.json?.jobs || []).map((j) => j.externalId);
  T('production: rep sees only their own cards', rids.includes('e2e-res-1') && !rids.includes('e2e-other-1'), rids.join(','));
}

// ---------------------------------------------------------- contact actions ----
{
  const g = await api('rep', 'GET', '/api/clients/e2e-res-1/ghl-contact');
  T('contact actions: GHL lookup degrades gracefully without a token (no 500)', g.status !== 500 && g.json && typeof g.json === 'object', `${g.status} ${JSON.stringify(g.json).slice(0, 120)}`);
  const bad = await api('rep', 'POST', '/api/clients/e2e-res-1/call-log', { via: 'carrier-pigeon' });
  T('contact actions: invalid channel rejected', bad.status === 400, `${bad.status} ${bad.json?.error}`);
  const log = await api('rep', 'POST', '/api/clients/e2e-res-1/call-log', { via: 'phone' });
  T('contact actions: call log without GHL is a clean error, not a crash', log.status !== 500 && log.json?.error, `${log.status} ${JSON.stringify(log.json).slice(0, 120)}`);
  const msg = await api('rep', 'POST', '/api/clients/e2e-other-1/message', { channel: 'sms', body: 'hi' });
  T('contact actions: cannot message another rep\'s client', msg.status === 404, msg.status);
}

// ---------------------------------------------------------------- misc ----
{
  const st = await api('rep', 'GET', '/api/reports/status');
  T('reports: status endpoint answers', st.status === 200, JSON.stringify(st.json).slice(0, 120));
  const cron = await fetch(BASE + '/api/sync/rooflink/health');
  T('sync: rooflink health answers without crashing', cron.status < 500, cron.status);
}

const pass = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ pass, fail: results.length - pass, results }, null, 1));
fs.writeFileSync(process.env.E2E_OUT || 'e2e-results.json', JSON.stringify(results, null, 1));
fs.writeFileSync((process.env.E2E_OUT || 'e2e-results.json').replace('.json', '-reports.json'), JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k, v]) => [k, { id: v.id, externalId: v.externalId }])), null, 1));
