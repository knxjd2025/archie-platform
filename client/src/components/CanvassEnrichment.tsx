/**
 * What Tracerfy knows about a canvassed home — owner, phones with DNC/TCPA
 * flags, emails, roof and property facts — and the button that pulls it.
 */
import { formatPhone } from '../lib/format';
import { CREDITS_PER_PROPERTY_LOOKUP, usd } from '../../../shared/canvass-areas';

export interface Enrichment {
  updatedAt?: string | null;
  canvassPropertyId: number; areaId: number | null; inArea: boolean | null;
  ownerName: string | null; owner2Name: string | null; mailingAddress: string | null;
  phones: Array<{ number: string; type: string | null; carrier: string | null; dnc: boolean; tcpa: boolean }>;
  emails: Array<{ email: string }>;
  litigator: boolean | null; propertyType: string | null; yearBuilt: number | null; buildingSqft: number | null;
  roofMaterial: string | null; roofConstruction: string | null; estimatedValue: number | null; equityPercent: number | null;
  yearsOwned: number | null; ownerOccupied: boolean | null; absenteeOwner: boolean | null; highEquity: boolean | null; freeClear: boolean | null;
  vacant: boolean | null; mlsActive: boolean | null; roofScore: number | null; sellScore: number | null;
}

export function roofScoreTone(score: number | null): string {
  if (score == null) return 'bg-gray-100 text-gray-500';
  if (score >= 70) return 'bg-emerald-100 text-emerald-700';
  if (score >= 40) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

export default function CanvassEnrichment({ e, busy, onPull }: { e: Enrichment | null; busy: boolean; onPull: () => void }) {
  if (!e) {
    return (
      <button onClick={onPull} disabled={busy} className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50" title={`Owner name, phones, emails, year built, roof material and a roof-replacement score. ${CREDITS_PER_PROPERTY_LOOKUP} credits (${usd(CREDITS_PER_PROPERTY_LOOKUP)}) on a hit, free on a miss.`}>
        🔎 {busy ? 'Looking up…' : `Owner & roof info · ${usd(CREDITS_PER_PROPERTY_LOOKUP)}`}
      </button>
    );
  }
  const age = e.yearBuilt ? new Date().getFullYear() - e.yearBuilt : null;
  const facts = [
    e.yearBuilt ? `built ${e.yearBuilt}${age != null ? ` (${age} yrs)` : ''}` : null,
    e.roofMaterial ? `${e.roofMaterial}${e.roofConstruction ? ` ${e.roofConstruction.toLowerCase()}` : ''} roof` : null,
    e.buildingSqft ? `${e.buildingSqft.toLocaleString()} sq ft` : null,
    e.estimatedValue ? `~$${Math.round(e.estimatedValue / 1000)}k` : null,
    e.equityPercent != null ? `${Math.round(e.equityPercent)}% equity` : null,
    e.yearsOwned != null ? `owned ${e.yearsOwned} yrs` : null,
    e.ownerOccupied ? 'owner lives there' : e.absenteeOwner ? 'absentee owner' : null,
    e.freeClear ? 'paid off' : e.highEquity ? 'high equity' : null,
    e.mlsActive ? '⚠️ listed for sale' : null,
    e.vacant ? 'vacant' : null,
  ].filter(Boolean);
  return (
    <div className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">🏠 {e.ownerName || 'Owner unknown'}{e.owner2Name ? ` & ${e.owner2Name}` : ''}</span>
        {e.roofScore != null && <span className={`text-[10px] px-1.5 py-0.5 rounded ${roofScoreTone(e.roofScore)}`} title="Tracerfy roof-replacement propensity, 0–100">roof score {e.roofScore}</span>}
        {e.inArea === false && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">outside drawn area</span>}
        {e.litigator && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700" title="Known TCPA litigator — do not call or text">⚠️ litigator</span>}
      </div>
      {facts.length > 0 && <p className="text-gray-600">{facts.join(' · ')}</p>}
      <p className="text-gray-500">Source: Tracerfy · Updated: {e.updatedAt ? new Date(e.updatedAt).toLocaleString() : 'unknown'}</p>
      {e.phones.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {e.phones.map((p) => {
            const blocked = p.dnc || p.tcpa;
            return (
              <span key={p.number} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${blocked ? 'bg-white border-red-200 text-red-700 line-through decoration-red-300' : 'bg-white border-gray-200 text-gray-800'}`} title={`${p.type || 'Phone'}${p.carrier ? ` · ${p.carrier}` : ''}${p.dnc ? ' · on the Do-Not-Call list' : ''}${p.tcpa ? ' · TCPA flag' : ''}`}>
                {blocked ? '🚫' : p.type && /mobile/i.test(p.type) ? '📱' : '☎️'} {formatPhone(p.number)}
              </span>
            );
          })}
        </div>
      )}
      {e.emails.length > 0 && <p className="text-gray-600">✉️ {e.emails.map((x) => x.email).join(' · ')}</p>}
      {e.mailingAddress && e.absenteeOwner && <p className="text-gray-500">Mails to: {e.mailingAddress}</p>}
    </div>
  );
}
