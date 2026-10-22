export default function OutreachLeads({ onNavigate, campaignId }: { onNavigate: (page: string, data?: any) => void, campaignId?: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Outreach Leads</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <div className="text-4xl mb-3">👥</div>
        <p className="text-sm font-medium text-gray-800">Outreach lead management coming soon.</p>
        <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">Track who's in each campaign and how they're responding.</p>
        {campaignId && <p className="text-xs text-gray-400 mt-2">Campaign: {campaignId}</p>}
        <button
          onClick={() => onNavigate('outreach')}
          className="mt-5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
        >
          ← Back to Outreach
        </button>
      </div>
    </div>
  );
}
