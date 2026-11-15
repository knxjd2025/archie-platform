// Commercial roofing cheat sheet. Fixed, hand-authored content so it loads
// instantly on a roof or in a lobby. Facts are general trade practice, plus a
// few numbers carried over as written from the old Commercial Training page.
// Always follow the manufacturer's spec and local code on each job.

import { useState } from 'react';
import { Section, SectionChips, useScrollSpy } from './shared';

const SECTION_META: { id: string; label: string }[] = [
  { id: 'process', label: 'Sales Process' },
  { id: 'qualify', label: 'Qualifying' },
  { id: 'deciders', label: 'Decision Makers' },
  { id: 'systems', label: 'Roof Systems' },
  { id: 'lookfor', label: 'What to Look For' },
  { id: 'options', label: 'Repair / Restore / Replace' },
  { id: 'proposal', label: 'The Proposal' },
  { id: 'maintenance', label: 'Maintenance Plans' },
  { id: 'never', label: 'Never Do This' },
];

const STEPS = [
  { n: 1, title: 'Lead and Access', body: 'Get the property address, who owns it, who manages it, and who can give roof access.' },
  { n: 2, title: 'Qualify', body: 'Roof age, leak history, warranty, budget and timing. Find out who decides.' },
  { n: 3, title: 'Inspect', body: 'Walk the inside first, then the roof. Same order every time. Core with the owner\'s OK.' },
  { n: 4, title: 'Document', body: 'Photos wide, medium, close. Measure. Sketch the roof and mark every problem.' },
  { n: 5, title: 'Present Options', body: 'Repair, restore or replace, with the reason for each. Show the photos.' },
  { n: 6, title: 'Proposal', body: 'Clear scope, system, details, schedule and terms. Written so a committee can read it.' },
  { n: 7, title: 'Follow Up and Close', body: 'Check in with every decision maker. Answer questions, then get the signature.' },
  { n: 8, title: 'Handoff', body: 'Pass the scope, photos, access notes and contacts to production. Offer a maintenance plan.' },
];

const QUALIFYING_QUESTIONS = [
  'Who owns the building, and who manages it?',
  'Who signs off on a roof project?',
  'How old is the roof, and what type is it?',
  'Any active leaks? Where, and since when?',
  'What repairs have been done, and by whom?',
  'Is there a warranty? Who holds it?',
  'Any inspection reports or past roof drawings?',
  'Has there been a storm or an insurance claim?',
  'Is this a planned budget item or an emergency?',
  'When does the money need to be spent or approved?',
  'Does a lender, insurer or ownership group need to approve?',
  'Tenants or operations underneath? Quiet hours, noise limits?',
  'How do we get on the roof: hatch, ladder, alarm, escort?',
  'Is anyone else bidding?',
];

const DECIDERS: { who: string; cares: string }[] = [
  { who: 'Building owner', cares: 'Cost, how long it lasts, and protecting the asset.' },
  { who: 'Property manager', cares: 'Fewer tenant complaints, a clear schedule, and no surprises.' },
  { who: 'Facilities manager', cares: 'Access, safety, how the work affects daily operations.' },
  { who: 'Asset manager or ownership group', cares: 'Budget, return on the spend, and the long-term plan.' },
  { who: 'Finance or purchasing', cares: 'Written bids, terms, insurance certificates, and paperwork.' },
  { who: 'HOA or board', cares: 'Votes and meeting dates. Plan your timeline around them.' },
  { who: 'Tenant', cares: 'Disruption to their business. They may also pay part of the roof cost under their lease.' },
  { who: 'Lender or insurer', cares: 'Condition reports and documentation. They can require work or approve it.' },
];

const SYSTEMS: { name: string; spot: string; check: string; life: string }[] = [
  {
    name: 'TPO',
    spot: 'White, gray or tan single-ply sheet. Seams are heat welded, so you see a smooth melted edge, not glue.',
    check: 'Cold or skipped welds, open edges, punctures, cracks on older or thin sheets.',
    life: '20 to 30 yrs',
  },
  {
    name: 'PVC',
    spot: 'Looks like TPO but feels softer. Often a small melted bead at the seams. Common on restaurants because it stands up to grease.',
    check: 'Stiff, cracking sheet on old roofs. Breaks down when it touches asphalt, tar or some sealants.',
    life: '20 to 30 yrs',
  },
  {
    name: 'EPDM',
    spot: 'Black rubber sheet, sometimes white. Seams are glued or taped with sealant on the edge. Some are held down with river rock (ballast).',
    check: 'Seams letting go, shrinkage pulling the sheet off walls, punctures, dried out sealant.',
    life: '20 to 30 yrs',
  },
  {
    name: 'Modified bitumen',
    spot: 'Asphalt rolls with granules on top, like a big shingle roll. Laps are 3 to 4 inches wide. Torched, mopped or peel and stick.',
    check: 'Blisters, open laps, granule loss, alligator cracks, slipping on slopes.',
    life: '15 to 20 yrs',
  },
  {
    name: 'Built-up (BUR)',
    spot: 'Tar and gravel. Many layers of felt and hot asphalt with gravel on top.',
    check: 'Bare spots, blisters, cracks, empty pitch pans, rotted gravel stop.',
    life: '20 to 30 yrs',
  },
  {
    name: 'Metal',
    spot: 'Through-fastened panels (visible screws, like R-panel) or standing seam (raised ribs, hidden clips).',
    check: 'Screws backing out, cracked washers, rust, open laps, bad curb flashings.',
    life: '30 to 50 yrs',
  },
  {
    name: 'Coatings',
    spot: 'Silicone, acrylic or similar liquid sprayed or rolled over an old roof. Looks like a seamless painted surface.',
    check: 'Peeling, thin or bare spots, dirt build up, acrylic breaking down where water ponds.',
    life: '10 to 20 yrs',
  },
];

const LOOK_FOR: { title: string; body: string }[] = [
  { title: 'Inside first', body: 'Ceiling stains, wet tiles, buckets, rust on the metal deck, mold. Sketch each leak so you can find the spot from above.' },
  { title: 'Edges', body: 'Edge metal, coping, parapet flashing, gutters, scuppers. Wind damage starts here.' },
  { title: 'Seams', body: 'Probe welded seams. Look for lifted laps or missing sealant on EPDM and mod bit.' },
  { title: 'Penetrations', body: 'Pipes, vents, pitch pans, curbs, skylights, hatch. Most leaks come from these, not the open field.' },
  { title: 'Drains', body: 'Strainer on, clamping ring tight, no debris, no water line around it.' },
  { title: 'Ponding', body: 'Water still sitting 48 hours after rain. On a dry day look for dirt rings and stains.' },
  { title: 'Equipment', body: 'Missing HVAC panels, leaking condensate lines, grease from kitchen fans, worn foot paths.' },
  { title: 'Soft spots', body: 'Spongy or crunchy underfoot can mean wet insulation. Mark it and core with permission.' },
];

const GOOD_LOOKS_LIKE: { big: string; body: string }[] = [
  { big: '1.5 in', body: 'TPO weld width. Welded seams need at least 1.5 inches of true weld (Versico spec).' },
  { big: 'Probe', body: 'A dull probe will not go into a good weld. If it slides into the lap, mark the start and end.' },
  { big: '8 in', body: 'Base flashing at walls and curbs goes at least 8 inches above the finished roof (NRCA guideline).' },
  { big: '48 hr', body: 'Water still on the roof 48 hours after rain is ponding.' },
];

const OPTIONS: { name: string; accent: string; points: string[] }[] = [
  {
    name: 'Repair',
    accent: 'bg-blue-700',
    points: [
      'Problems are in a few spots: a seam, a curb, a drain.',
      'The rest of the membrane is in good shape.',
      'Insulation is dry.',
      'The roof has good life left.',
    ],
  },
  {
    name: 'Restore',
    accent: 'bg-brand-accent',
    points: [
      'Membrane is aging but still holding.',
      'Insulation is mostly dry. Confirm with a moisture survey and cores. Wet spots get cut out first.',
      'Owner wants to push replacement off for years at a lower cost.',
      'A recover is only allowed if there is just one roof on it now.',
    ],
  },
  {
    name: 'Replace',
    accent: 'bg-ink',
    points: [
      'Wet insulation over large areas.',
      'Membrane at end of life: cracking, shrinking, seams failing all over.',
      'Already two roofs on it. The code does not allow a third, so it must be torn off. Confirm local code.',
      'Deck damage or rust found in cores.',
    ],
  },
];

const PROPOSAL_ITEMS = [
  'Property address, contacts, and the date of your inspection.',
  'What you found: key photos and a short summary of conditions.',
  'Scope of work by roof area, with measurements.',
  'The roof system, the manufacturer, and the product names.',
  'Insulation and slope: what is kept, what is replaced, what is added.',
  'Edge metal, flashings, drains and penetrations: how each will be handled.',
  'Hidden conditions: how wet insulation or deck repairs are priced if found (for example, a unit price).',
  'Warranty: what the manufacturer and the company each provide, exactly as written in the warranty documents.',
  'Schedule, working hours, access, staging, and how tenants will be protected.',
  'Safety plan, insurance certificates, and any permits.',
  'Price, payment terms, and what is not included.',
  'Options, when there is more than one way to solve it.',
];

const MAINTENANCE_ITEMS = [
  'Scheduled inspections, often in spring and fall, and after major storms.',
  'Clear drains, scuppers and debris. Check strainers.',
  'Check seams, flashings, edge metal, penetrations and sealant.',
  'Small repairs done on the visit, so little leaks never get big.',
  'A photo report after every visit, with notes on what to watch.',
  'A dated record of work. It helps with warranty questions and with budget planning.',
  'A clear plan and budget for when the roof will need bigger work.',
];

const NEVER_DO = [
  'Never go on a roof alone. Tell the office the address and when you go up and come down.',
  'Never step on a skylight or plastic panel.',
  'Never promise a warranty term or a coverage outcome.',
  'Never recommend a coating before checking for wet insulation. Wet insulation cannot be coated over.',
  'Never use a repair product that is not made for that membrane.',
  'Never quote a job without measuring the roof.',
  'Never leave without knowing who makes the decision and what the next step is.',
  'Never rely on one contact when several people sign off.',
  'Never skip the photos. Wide, medium, close, with a tape for scale.',
  'Never text or call clients from a personal device. Use company systems.',
];

export default function CommercialSheet() {
  const activeSection = useScrollSpy(SECTION_META);
  const [checked, setChecked] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('archie.cheatSheetCommercialChecked');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      try { localStorage.setItem('archie.cheatSheetCommercialChecked', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="space-y-5 pb-10">
      <SectionChips sections={SECTION_META} active={activeSection} />

      <Section id="process" title="The Commercial Sales Process" accent="bg-ink">
        <ol className="space-y-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-ink text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{s.n}</span>
              <div><span className="font-semibold text-gray-900">{s.title}.</span> <span className="text-gray-600">{s.body}</span></div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="qualify" title="Qualifying Questions" accent="bg-blue-700">
        <p className="text-xs text-gray-500 mb-2">For the property manager or building owner.</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {QUALIFYING_QUESTIONS.map((q) => (
            <li key={q} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">• {q}</li>
          ))}
        </ul>
      </Section>

      <Section id="deciders" title="Who Decides" accent="bg-brand-accent">
        <p className="text-xs text-gray-500 mb-2">Several of these may sign off. Ask early who they are.</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {DECIDERS.map((d) => (
            <div key={d.who} className="bg-gray-50 rounded-lg p-3">
              <dt className="font-semibold text-ink">{d.who}</dt>
              <dd className="text-gray-600">{d.cares}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="systems" title="Reading the Roof: Systems" accent="bg-blue-700">
        <p className="text-sm text-gray-700 mb-3">
          <b>Quick ID:</b> find a seam. Melted and welded together is TPO or PVC. Glued or taped with sealant on the edge is EPDM. Granules with a 3 to 4 inch lap is mod bit. Gravel is BUR.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {SYSTEMS.map((s) => (
            <div key={s.name} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <p className="font-semibold text-ink">{s.name}</p>
                <p className="text-xs text-gray-500">{s.life}</p>
              </div>
              <p className="text-gray-700"><span className="font-medium text-gray-900">Spot it:</span> {s.spot}</p>
              <p className="text-gray-700 mt-1"><span className="font-medium text-gray-900">Look for:</span> {s.check}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">Life spans are rough ranges. Install quality, sheet thickness, weather and upkeep change them a lot.</p>
      </Section>

      <Section id="lookfor" title="What to Look For" accent="bg-ink">
        <ul className="space-y-2">
          {LOOK_FOR.map((l, i) => {
            const isChecked = checked.has(i);
            return (
              <li key={l.title}>
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="flex items-start gap-2 text-sm text-gray-700 w-full text-left"
                >
                  <span
                    className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] leading-none text-white ${
                      isChecked ? 'bg-blue-700 border-blue-700' : 'border-gray-300'
                    }`}
                    aria-hidden
                  >
                    {isChecked ? '✓' : ''}
                  </span>
                  <span className={isChecked ? 'text-gray-400' : ''}><span className="font-semibold">{l.title}.</span> {l.body}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="font-semibold text-gray-900 text-sm mt-4 mb-2">What good looks like</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {GOOD_LOOKS_LIKE.map((g) => (
            <div key={g.big} className="bg-gray-50 rounded-lg p-3">
              <p className="font-semibold text-ink">{g.big}</p>
              <p className="text-gray-600">{g.body}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">These are common industry guidelines. Always follow the manufacturer's spec and local code.</p>
      </Section>

      <Section id="options" title="Repair, Restore or Replace" accent="bg-blue-700">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {OPTIONS.map((o) => (
            <div key={o.name} className="bg-gray-50 rounded-lg overflow-hidden">
              <div className={`px-3 py-1.5 text-white font-semibold text-xs ${o.accent}`}>{o.name}</div>
              <ul className="p-3 space-y-1.5 text-gray-700">
                {o.points.map((p) => <li key={p}>• {p}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">Use what you found, not what is easiest to sell. Show the photos that support the option.</p>
      </Section>

      <Section id="proposal" title="What Goes in a Commercial Proposal" accent="bg-ink">
        <ul className="space-y-2">
          {PROPOSAL_ITEMS.map((p) => (
            <li key={p} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">• {p}</li>
          ))}
        </ul>
      </Section>

      <Section id="maintenance" title="Maintenance Plans" accent="bg-brand-accent">
        <p className="text-xs text-gray-500 mb-2">A plan keeps you in front of the owner and keeps small problems small.</p>
        <ul className="space-y-2">
          {MAINTENANCE_ITEMS.map((m) => (
            <li key={m} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">• {m}</li>
          ))}
        </ul>
      </Section>

      <Section id="never" title="Never Do This" accent="bg-red-600">
        <ul className="space-y-2">
          {NEVER_DO.map((n) => (
            <li key={n} className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
