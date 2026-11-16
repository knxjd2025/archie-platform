/**
 * Current CRM: the CRM a company already uses, if any. Archie works on its
 * own; connecting a CRM brings that CRM's jobs and contacts in. JobTread is
 * the one that can be connected today.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import JobTreadBrowser from './JobTreadBrowser';
import { announceConnectionsChanged, Field, FormError, IntegrationCard, PrimaryButton, SecondaryButton, StatusPill, useConnection, type ConnectionState } from './ui';

const PATH = '/api/integrations/crm/connection';

export default function CurrentCrmCard() {
  const { state, setState, loadError } = useConnection(PATH);
  const [grantKey, setGrantKey] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setState(await api.put<ConnectionState>(PATH, { provider: 'jobtread', grantKey: grantKey.trim(), organizationId: organizationId.trim() }));
      setGrantKey('');
      setOrganizationId('');
      announceConnectionsChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not connect JobTread.');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect JobTread? Archie stops reading and writing your JobTread jobs until you connect it again.')) return;
    setRemoving(true);
    setError(null);
    try {
      setState(await api.delete<ConnectionState>(PATH));
      announceConnectionsChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not disconnect JobTread.');
    } finally {
      setRemoving(false);
    }
  };

  const connected = !!state?.connected;

  return (
    <IntegrationCard
      id="current-crm"
      title="Current CRM"
      summary="Use Archie on its own, or connect the CRM you already use."
      status={<StatusPill connected={connected} loading={!state && !loadError} />}
    >
      <FormError message={loadError} />

      {state && (
        <div className="rounded-lg border border-gray-200">
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">JobTread</p>
              <p className="text-xs text-gray-500">
                {connected
                  ? <>Connected{state.accountName ? <> to <strong className="text-gray-700">{state.accountName}</strong></> : ''}{state.source === 'shared' ? ' (set up by Archie for your company)' : ''}</>
                  : 'Jobs, contacts and invoices from your JobTread account.'}
              </p>
            </div>
            {connected && state.source === 'company' && (
              <SecondaryButton danger onClick={disconnect} busy={removing} busyLabel="Disconnecting...">Disconnect</SecondaryButton>
            )}
          </div>

          {!connected && (
            <form onSubmit={connect} className="p-4 space-y-4 max-w-xl" aria-label="Connect JobTread">
              <Field
                label="Grant key"
                hint="Create a grant key in JobTread's API settings and paste it here."
                type="password"
                value={grantKey}
                onChange={setGrantKey}
                autoComplete="new-password"
                required
              />
              <Field
                label="Organization ID (optional)"
                hint="Only needed if your grant key opens more than one JobTread organization."
                value={organizationId}
                onChange={setOrganizationId}
              />
              <FormError message={error} />
              <PrimaryButton busy={saving} busyLabel="Checking...">Connect JobTread</PrimaryButton>
            </form>
          )}
          {connected && error && <div className="p-4"><FormError message={error} /></div>}
        </div>
      )}

      {connected && (
        <div className="pt-1">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Your JobTread data</h3>
          <JobTreadBrowser />
        </div>
      )}

      <p className="text-sm text-gray-500">Using a different CRM? Tell us which one.</p>
    </IntegrationCard>
  );
}
