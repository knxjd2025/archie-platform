export default function CampaignWizard({ onNavigate, editCampaignId }: { onNavigate: (page: string, data?: any) => void, editCampaignId?: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Campaign Wizard</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <div className="text-4xl mb-3">🛠️</div>
        <p className="text-sm font-medium text-gray-800">Campaign builder coming soon.</p>
        <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">You'll be able to create and schedule outreach campaigns here.</p>
        {editCampaignId && <p className="text-xs text-gray-400 mt-2">Editing campaign: {editCampaignId}</p>}
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
