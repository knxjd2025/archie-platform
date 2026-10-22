import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { groupNewestFirst } from '../lib/doc-order';

interface ApprovedDoc {
  id: number;
  customer: string | null;
  jobRef: string | null;
  type: string | null;
  amount: number | null;
  status: string | null;
  issueDate: string | null;
  signedAt: string | null;
}


export default function Documents() {
  const [docs, setDocs] = useState<ApprovedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ documents: ApprovedDoc[] }>('/api/documents/approved');
      setDocs(res.documents || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Filter by client name (case-insensitive substring), then group by client
  // (customer name, falling back to the job), most recently approved first.
  const clientOf = (d: ApprovedDoc) => d.customer || d.jobRef || 'Unknown';
  const filteredDocs = search.trim()
    ? docs.filter((d) => clientOf(d).toLowerCase().includes(search.trim().toLowerCase()))
    : docs;

  const groups = groupNewestFirst(filteredDocs, clientOf);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Approved Documents</h2>
          <p className="text-sm text-gray-500 mt-1">Signed & approved customer proposals and contracts{docs.length ? ` · ${docs.length}` : ''}{(() => { const t = docs.reduce((s, d) => s + (d.amount || 0), 0); return t > 0 ? ` · ${money(t)} total` : ''; })()}</p>
        </div>
        <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {!loading && !error && docs.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client name…"
          className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy/30"
        />
      )}

      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 bg-gray-100 rounded-xl border border-gray-200 animate-pulse" />)}</div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-red-600 font-medium">Couldn't load documents</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={load} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      ) : docs.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
          No approved documents yet.
        </p>
      ) : filteredDocs.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
          No documents match "{search.trim()}".
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([client, items]) => (
            <div key={client} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">{client}</h3>
                <span className="text-xs text-gray-400">
                  {(() => { const t = items.reduce((s, d) => s + (d.amount || 0), 0); return t > 0 ? <span className="text-emerald-600 font-medium mr-2">{money(t)}</span> : null; })()}
                  {items.length} doc{items.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {items.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-lg">📄</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{d.type || 'Proposal'}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {d.jobRef || ''}
                        {(d.signedAt || d.issueDate) && (
                          <span> · {d.signedAt ? `Signed ${fmtDate(d.signedAt)}` : `Issued ${fmtDate(d.issueDate)}`}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {money(d.amount) && <p className="text-sm font-medium text-emerald-700">{money(d.amount)}</p>}
                      {d.status && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 capitalize">{d.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
