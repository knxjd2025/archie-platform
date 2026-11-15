/**
 * Google Workspace, as before: Gmail, Calendar and Drive through the
 * company service account's domain-wide delegation. Nothing to connect here.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useCompany } from '../../lib/company';

interface GoogleStatus {
  connected: boolean;
  email?: string;
  error?: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  htmlLink?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  createdTime: string;
  webViewLink?: string;
}

function formatMimeType(mime: string): string {
  const map: Record<string, string> = {
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder': 'Folder',
    'application/pdf': 'PDF',
    'image/jpeg': 'Image',
    'image/png': 'Image',
  };
  return map[mime] || mime.split('/').pop() || 'File';
}

function formatDate(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function GoogleWorkspacePanel() {
  const company = useCompany();
  // The company's email domain, when its profile has an email, to name the Workspace domain.
  const workspaceDomain = company.email.includes('@') ? company.email.split('@').pop() : '';
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const loadGoogleData = async () => {
    setLoadingGoogle(true);
    try {
      const status = await api.get<GoogleStatus>('/api/integrations/google/status');
      setGoogleStatus(status);

      if (status.connected) {
        const [eventsRes, filesRes] = await Promise.allSettled([
          api.get<{ events: CalendarEvent[] }>('/api/integrations/google/calendar/events?maxResults=10'),
          api.get<{ files: DriveFile[] }>('/api/integrations/google/drive/files?maxResults=15'),
        ]);
        if (eventsRes.status === 'fulfilled') setCalendarEvents(eventsRes.value.events || []);
        if (filesRes.status === 'fulfilled') setDriveFiles(filesRes.value.files || []);
      }
    } catch (e) {
      setGoogleStatus({ connected: false, error: 'Could not reach server' });
    } finally {
      setLoadingGoogle(false);
    }
  };

  useEffect(() => { void loadGoogleData(); }, []);

  return (
    <div className="space-y-6">
      {loadingGoogle ? (
        <div className="flex items-center justify-center h-40" role="status" aria-label="Loading Google integration status">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <>
          {/* Connection card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-2xl">G</div>
                <div>
                  <h3 className="font-semibold text-gray-900">Google Workspace</h3>
                  <p className="text-sm text-gray-500">Gmail · Calendar · Drive</p>
                </div>
              </div>
              {/* No connect/disconnect: Workspace is reached through the
                  company service account's domain-wide delegation, which
                  signs you in as yourself. There is no per-user token to
                  grant or revoke. */}
              <div className="sm:text-right">
                {googleStatus?.connected ? (
                  <>
                    <p className="text-sm font-medium text-green-600">Connected</p>
                    <p className="text-xs text-gray-500">{googleStatus.email}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-amber-600">Unavailable</p>
                    <p className="text-xs text-gray-500 max-w-xs">
                      {googleStatus?.error || 'Checking...'}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          {googleStatus?.connected && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Calendar Events */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Upcoming Events</h3>
                  <span className="text-xs text-gray-400">Next 30 days</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {calendarEvents.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-gray-400">No upcoming events</p>
                  ) : (
                    calendarEvents.slice(0, 8).map(event => {
                      const start = event.start.dateTime || event.start.date;
                      return (
                        <div key={event.id} className="px-5 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{event.summary}</p>
                              {event.location && (
                                <p className="text-xs text-gray-400 truncate">{event.location}</p>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 whitespace-nowrap">{formatDateTime(start)}</p>
                          </div>
                          {event.attendees && event.attendees.length > 0 && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {event.attendees.slice(0, 3).map(a => a.displayName || a.email).join(', ')}
                              {event.attendees.length > 3 ? ` +${event.attendees.length - 3} more` : ''}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Drive Files */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Recent Drive Files</h3>
                  <span className="text-xs text-gray-400">Most recently modified</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {driveFiles.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-gray-400">No files found</p>
                  ) : (
                    driveFiles.slice(0, 10).map(file => (
                      <div key={file.id} className="px-5 py-3 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded shrink-0">
                            {formatMimeType(file.mimeType)}
                          </span>
                          {file.webViewLink ? (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline truncate"
                            >
                              {file.name}
                            </a>
                          ) : (
                            <p className="text-sm text-gray-900 truncate">{file.name}</p>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 whitespace-nowrap">
                          {formatDate(file.modifiedTime)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {!googleStatus?.connected && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 sm:p-6 text-sm text-blue-800 space-y-2">
              <p className="font-semibold">Workspace isn't reachable for your account</p>
              <p className="text-blue-700">
                There's nothing to connect here. The app reads your Gmail, Calendar and Drive
                through the company service account, which signs in as you. If this says
                unavailable, an admin needs to check one of:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-blue-700">
                <li>Your mailbox is on the company's Google Workspace domain{workspaceDomain && <> (<strong>@{workspaceDomain}</strong>)</>}</li>
                <li>The service account's <strong>domain-wide delegation</strong> in Workspace admin lists the Calendar, Gmail and Drive scopes</li>
                <li><code className="bg-blue-100 px-1 rounded">GOOGLE_SA_EMAIL</code> and <code className="bg-blue-100 px-1 rounded">GOOGLE_SA_KEY</code> are set on the server</li>
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  );
}
