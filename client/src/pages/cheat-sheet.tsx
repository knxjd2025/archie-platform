// Static field reference, ported from BRN_Sales_Rep_Cheat_Sheet.pdf — "keep
// this in the truck." No API call; the content is fixed and hand-authored so
// it loads instantly on a phone in the field.

import { useEffect, useRef, useState } from 'react';

const SECTION_META: { id: string; label: string }[] = [
  { id: 'process', label: '6-Step Process' },
  { id: 'qualify', label: 'Qualifying' },
  { id: 'quickread', label: 'Retail vs Insurance' },
  { id: 'carp', label: 'CARP / ARO' },
  { id: 'terms', label: 'Insurance Terms' },
  { id: 'filing', label: 'Filing a Claim' },
  { id: 'adjuster', label: 'Adjuster Meeting' },
  { id: 'never', label: 'Never Do This' },
];

const STEPS = [
  { n: 1, title: 'Lead Intake', body: 'Qualify, get name/address/phone/email.' },
  { n: 2, title: 'Inspection', body: 'Photos, drone, document everything, ID job type.' },
  { n: 3, title: 'Education', body: 'Explain process, roof system, insurance basics.' },
  { n: 4, title: 'Proposal', body: 'Good/Better/Best in JobTread, warranty, timeline.' },
  { n: 5, title: 'Contract', body: 'Sign, collect payment/first check, file claim, explain portal access.' },
  { n: 6, title: 'Handoff', body: 'Finalize JobTread, submit to production.' },
];

const QUALIFYING_QUESTIONS = [
  'Active leak?',
  'When did the damage occur?',
  'Filed an insurance claim already?',
  'Are you the property owner?',
  'What type of roof do you have?',
  'Will you be at the appointment?',
];

const INSURANCE_TERMS: { term: string; def: string }[] = [
  { term: 'RCV', def: 'Full replacement cost, no depreciation.' },
  { term: 'ACV', def: 'RCV minus depreciation — this is the first check.' },
  { term: 'Deductible', def: "Homeowner's portion. Never waive it." },
  { term: 'Depreciation', def: 'The holdback, released after COC.' },
  { term: 'Supplement', def: 'Additional payment request for missed scope.' },
  { term: 'Scope of Work', def: 'The carrier-approved repair list.' },
  { term: 'VRA', def: 'Shingle sample sent for lab testing on repair disputes.' },
  { term: 'LOC', def: 'Letter of Credit, releases held depreciation.' },
];

const FILING_STEPS = [
  'Get policy docs, verify coverage and deductible.',
  'Call carrier with homeowner on speaker, get claim #.',
  'Record claim #, policy #, adjuster info in RoofLink/JobTread.',
  'Sign service agreement, scan into file.',
  'Tell homeowner: call us the second the adjuster reaches out.',
  'Mark up damage photos in CompanyCam.',
  'Walk them through their JobTread portal: photos, docs, messaging.',
];

const ADJUSTER_CHECKLIST = [
  'Arrive 15–20 min early',
  'Trade business cards',
  'Inspector + Sales Rep both attend',
  'Walk the roof, note code items',
  'Get clear scope before adjuster leaves',
  'Confirm: approved / denied / needs supplement / needs reinspection',
  'Was the roof chalked?',
];

const NEVER_DO = [
  'Never promise a coverage outcome.',
  'Never waive the deductible.',
  'Never skip the adjuster meeting.',
  'Never leave an appointment without a next step.',
  'Never text/call clients from a personal device — use company systems.',
  'Never leave a signing without explaining portal access.',
];

function Section({ id, title, accent, children }: { id: string; title: string; accent: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden scroll-mt-20">
      <div className={`px-4 py-2.5 text-white font-semibold text-sm ${accent}`}>{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function CheatSheet() {
  const [activeSection, setActiveSection] = useState<string>(SECTION_META[0].id);
  // Checked-off progress used to live only in React state and reset on every
  // navigation/reload — a rep checking things off mid-meeting lost it the
  // moment they tapped away.
  const [checkedItems, setCheckedItems] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('brn.cheatSheetChecked');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const toggleChecked = (i: number) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      try { localStorage.setItem('brn.cheatSheetChecked', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  // Scrollspy — highlight the quick-jump pill for whichever section is in view.
  const sectionElsRef = useRef<HTMLElement[]>([]);
  useEffect(() => {
    sectionElsRef.current = SECTION_META
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    );
    sectionElsRef.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sales Rep Cheat Sheet</h1>
        <p className="text-sm text-gray-500 mt-1">Keep this in the truck. Retail + Insurance, one page reference.</p>
      </div>

      {/* Quick-jump — this page is long, and it's meant to be used one-handed */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {SECTION_META.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border font-medium whitespace-nowrap ${
              activeSection === s.id ? 'bg-navy text-white border-navy' : 'bg-white border-gray-200 text-gray-600'
            }`}
          >
            {s.label}
          </a>
        ))}
      </div>

      <Section id="process" title="The 6-Step Sales Process" accent="bg-navy">
        <ol className="space-y-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-navy text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{s.n}</span>
              <div><span className="font-semibold text-gray-900">{s.title}</span> <span className="text-gray-600">— {s.body}</span></div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="qualify" title="Qualifying Questions" accent="bg-blue-700">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {QUALIFYING_QUESTIONS.map((q) => (
            <li key={q} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">• {q}</li>
          ))}
        </ul>
      </Section>

      <Section id="quickread" title="Retail vs Insurance: Quick Read" accent="bg-gold" >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-semibold text-gray-900 mb-1">Retail signals</p>
            <p className="text-gray-600">Aging roof, active leak with no storm, planned replacement, shopping multiple quotes, no qualifying storm damage.</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-semibold text-gray-900 mb-1">Insurance signals</p>
            <p className="text-gray-600">Recent hail/wind event, visible neighborhood damage, possible covered loss, time-sensitive.</p>
          </div>
        </div>
      </Section>

      <Section id="carp" title="CARP (Closing) & ARO (Objections)" accent="bg-blue-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-semibold text-gray-900 mb-2">CARP</p>
            <ul className="space-y-1.5 text-gray-700">
              <li><b>C</b>onnect — build rapport and trust</li>
              <li><b>A</b>ssess — storm vs retail approach</li>
              <li><b>R</b>eport — present findings and damage</li>
              <li><b>P</b>resent — deliver the solution</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-900 mb-2">ARO</p>
            <ul className="space-y-1.5 text-gray-700">
              <li><b>A</b>cknowledge the concern</li>
              <li><b>R</b>espond with education or a solution</li>
              <li><b>O</b>btain commitment to move forward</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section id="terms" title="Insurance Terms" accent="bg-blue-700">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {INSURANCE_TERMS.map((t) => (
            <div key={t.term} className="bg-gray-50 rounded-lg p-3">
              <dt className="font-semibold text-navy">{t.term}</dt>
              <dd className="text-gray-600">{t.def}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="filing" title="Filing the Claim — In Order" accent="bg-navy">
        <ol className="space-y-2">
          {FILING_STEPS.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-700">
              <span className="text-gray-400 font-medium">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="adjuster" title="Adjuster Meeting Checklist" accent="bg-blue-700">
        <ul className="space-y-2">
          {ADJUSTER_CHECKLIST.map((c, i) => {
            const isChecked = checkedItems.has(i);
            return (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => toggleChecked(i)}
                  className="flex items-center gap-2 text-sm text-gray-700 w-full text-left"
                >
                  <span
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] leading-none text-white ${
                      isChecked ? 'bg-blue-700 border-blue-700' : 'border-gray-300'
                    }`}
                    aria-hidden
                  >
                    {isChecked ? '✓' : ''}
                  </span>
                  <span className={isChecked ? 'text-gray-400 line-through' : ''}>{c}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="never" title="Never Do This" accent="bg-brick">
        <ul className="space-y-2">
          {NEVER_DO.map((n) => (
            <li key={n} className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
