export default function OutreachDashboard({ onNavigate }: { onNavigate: (page: string, data?: any) => void }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Outreach</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <div className="text-4xl mb-3">📣</div>
        <p className="text-sm font-medium text-gray-800">Outreach automation is on the way.</p>
        <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">Soon you'll be able to build campaigns and reach past customers right from here.</p>
        <button
          onClick={() => onNavigate('dashboard')}
          className="mt-5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
        >
          ← Back to Dashboard
        </button>
      </div>
    </div>
  );
}
