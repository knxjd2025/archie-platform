// Pieces both cheat sheets use: the section card, the sticky quick-jump chips,
// and the scrollspy that lights the chip for whichever section is in view.

import { useEffect, useState } from 'react';

export interface SectionMeta { id: string; label: string }

export function Section({ id, title, accent, children }: { id: string; title: string; accent: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden scroll-mt-20">
      <div className={`px-4 py-2.5 text-white font-semibold text-sm ${accent}`}>{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Which section is in view. Re-attaches when the list of sections changes. */
export function useScrollSpy(sections: SectionMeta[]): string {
  const [active, setActive] = useState<string>(sections[0].id);
  useEffect(() => {
    setActive(sections[0].id);
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);
  return active;
}

/** Quick-jump chips. These pages are long and are meant to be used one-handed. */
export function SectionChips({ sections, active }: { sections: SectionMeta[]; active: string }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border font-medium whitespace-nowrap ${
            active === s.id ? 'bg-ink text-white border-ink' : 'bg-white border-gray-200 text-gray-600'
          }`}
        >
          {s.label}
        </a>
      ))}
    </div>
  );
}
