/**
 * Integrations: one place for everything a company connects to Archie.
 * Each company's connections are its own; nothing here is shared between companies.
 */
import CompanyCamCard from './CompanyCamCard';
import CurrentCrmCard from './CurrentCrmCard';
import EmailCard from './EmailCard';
import KynexProCard from './KynexProCard';

export default function Integrations() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-1">Connect the tools your company already uses. Only admins can see this page.</p>
      </div>
      <KynexProCard />
      <CurrentCrmCard />
      <CompanyCamCard />
      <EmailCard />
    </div>
  );
}
