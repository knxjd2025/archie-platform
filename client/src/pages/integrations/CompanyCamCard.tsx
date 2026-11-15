/**
 * CompanyCam (optional): the company's own CompanyCam account, for job photos.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { announceConnectionsChanged, Field, FormError, IntegrationCard, PrimaryButton, SecondaryButton, StatusPill, useConnection, type ConnectionState } from './ui';

const PATH = '/api/integrations/companycam/connection';

export default function CompanyCamCard() {
  const { state, setState, loadError } = useConnection(PATH);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setState(await api.put<ConnectionState>(PATH, { token: token.trim() }));
      setToken('');
      announceConnectionsChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not connect CompanyCam.');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect CompanyCam? Job photos stop going to and from CompanyCam until you connect it again.')) return;
    setRemoving(true);
    setError(null);
    try {
      setState(await api.delete<ConnectionState>(PATH));
      announceConnectionsChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not disconnect CompanyCam.');
    } finally {
      setRemoving(false);
    }
  };

  const connected = !!state?.connected;

  return (
    <IntegrationCard
      id="companycam"
      title="CompanyCam"
      tag="Optional"
      summary="See a job's CompanyCam photos in Archie and send job photos to CompanyCam."
      status={<StatusPill connected={connected} loading={!state && !loadError} />}
    >
      <FormError message={loadError} />

      {connected && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">
            Connected{state?.accountName ? <> to <strong>{state.accountName}</strong></> : ''}
            {state?.source === 'shared' ? <span className="text-gray-500"> (set up by Archie for your company)</span> : ''}
          </p>
          {state?.source === 'company' && (
            <SecondaryButton danger onClick={disconnect} busy={removing} busyLabel="Disconnecting...">Disconnect</SecondaryButton>
          )}
        </div>
      )}
      {connected && <FormError message={error} />}

      {state && !connected && (
        <form onSubmit={connect} className="space-y-4 max-w-xl" aria-label="Connect CompanyCam">
          <Field
            label="API token"
            hint="Create an access token in CompanyCam's API settings and paste it here."
            type="password"
            value={token}
            onChange={setToken}
            autoComplete="new-password"
            required
          />
          <FormError message={error} />
          <PrimaryButton busy={saving} busyLabel="Checking...">Connect CompanyCam</PrimaryButton>
        </form>
      )}
    </IntegrationCard>
  );
}
