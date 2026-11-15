/**
 * KynexPro: every company connects its own sub-account. Texts, email and
 * calls in Archie go through it, so it is the one required integration.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { announceConnectionsChanged, CopyRow, Field, FormError, IntegrationCard, PrimaryButton, SecondaryButton, StatusPill } from './ui';

interface KynexProStatus {
  connected: boolean;
  locationId: string | null;
  webhook: { url: string; header: string; secret: string };
}

export default function KynexProCard() {
  const [status, setStatus] = useState<KynexProStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rotating, setRotating] = useState(false);

  const load = async () => {
    setLoadError(null);
    try { setStatus(await api.get<KynexProStatus>('/api/integrations/ghl/connection')); }
    catch (e: any) { setLoadError(e?.message || 'Could not load the KynexPro connection.'); }
  };
  useEffect(() => { void load(); }, []);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await api.put<{ connected: boolean; locationId: string; locationName?: string }>(
        '/api/integrations/ghl/connection', { locationId: locationId.trim(), token: token.trim() });
      setAccountName(r.locationName || null);
      setToken('');
      setEditing(false);
      await load();
      announceConnectionsChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not connect KynexPro.');
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm('Make a new webhook secret? KynexPro workflows using the old one stop reaching Archie until you paste the new one in.')) return;
    setRotating(true);
    try {
      const r = await api.post<{ secret: string }>('/api/integrations/ghl/webhook-secret/rotate');
      setStatus((s) => (s ? { ...s, webhook: { ...s.webhook, secret: r.secret } } : s));
    } catch (err: any) {
      setError(err?.message || 'Could not make a new secret.');
    } finally {
      setRotating(false);
    }
  };

  const connected = !!status?.connected;
  const showForm = status && (!connected || editing);

  return (
    <IntegrationCard
      id="kynexpro"
      title="KynexPro"
      tag="Required"
      summary="Texts, email and calls for your company run through your KynexPro account."
      status={<StatusPill connected={connected} loading={!status && !loadError} />}
    >
      <FormError message={loadError} />

      {connected && !editing && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {accountName ? <>Connected to <strong>{accountName}</strong></> : 'Connected'}
            {status?.locationId && <span className="text-gray-500"> (Location ID {status.locationId})</span>}
          </p>
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <p className="text-sm font-medium text-gray-900">Webhook</p>
            <p className="text-sm text-gray-500">
              In KynexPro, add a Webhook action to your workflows: paste the address as the URL, and the header name and secret as a custom header.
            </p>
            <CopyRow label="Webhook address" value={status!.webhook.url} />
            <CopyRow label="Header name" value={status!.webhook.header} />
            <CopyRow label="Secret" value={status!.webhook.secret} secret />
            <div className="flex flex-wrap gap-2 pt-1">
              <SecondaryButton onClick={rotate} busy={rotating} busyLabel="Rotating...">Rotate secret</SecondaryButton>
              <SecondaryButton onClick={() => { setEditing(true); setError(null); }}>Change account</SecondaryButton>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={connect} className="space-y-4 max-w-xl" aria-label="Connect KynexPro">
          <Field
            label="Location ID"
            hint="In KynexPro: Settings, Business Profile."
            value={locationId}
            onChange={setLocationId}
            required
          />
          <Field
            label="Private Integration Token"
            hint="In KynexPro: Settings, Private Integrations. Create one and copy its token."
            type="password"
            value={token}
            onChange={setToken}
            autoComplete="new-password"
            required
          />
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <PrimaryButton busy={saving} busyLabel="Checking...">Connect KynexPro</PrimaryButton>
            {editing && <SecondaryButton onClick={() => { setEditing(false); setError(null); }}>Cancel</SecondaryButton>}
          </div>
        </form>
      )}

      {connected && !editing && <FormError message={error} />}
    </IntegrationCard>
  );
}
