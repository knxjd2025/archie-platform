/**
 * Email: Google Workspace today. Outlook and other mailboxes are not built
 * yet, so they are named here and nothing more.
 */
import GoogleWorkspacePanel from './GoogleWorkspacePanel';
import { IntegrationCard } from './ui';

export default function EmailCard() {
  return (
    <IntegrationCard id="email" title="Email" summary="Your team's mailboxes, calendars and files.">
      <GoogleWorkspacePanel />
      <ul className="text-sm text-gray-500 space-y-1">
        <li>Outlook / Microsoft 365: coming soon</li>
        <li>Other email (IMAP): coming soon</li>
      </ul>
    </IntegrationCard>
  );
}
