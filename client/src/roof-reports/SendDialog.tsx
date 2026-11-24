import { useEffect, useRef } from 'react';
import { MAX_SEND_MESSAGE } from '../../../shared/roof-reports';
import { canSubmit, type SendField, type SendState } from './send-model';
import { RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;
const PRIMARY = `px-3 py-1.5 text-sm rounded-lg border border-blue-700 bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed ${FOCUS}`;
const FIELD = `w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 disabled:bg-gray-50 ${FOCUS}`;

export interface SendDialogProps {
  state: SendState;
  onEdit: (field: SendField, text: string) => void;
  onSend: () => void;
  onClose: () => void;
}

/** The "Email this report" dialog as it looks for the state it is handed. All the sending lives in Editor. */
export function SendDialog({ state, onEdit, onSend, onClose }: SendDialogProps) {
  const first = useRef<HTMLInputElement | null>(null);
  const open = state.phase !== 'closed';
  useEffect(() => { if (open) first.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && state.phase !== 'sending') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, state.phase, onClose]);
  if (!open) return null;

  const sending = state.phase === 'sending';
  const sent = state.phase === 'sent';
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="rr-send-title">
      <div className="absolute inset-0 bg-black/40" onClick={sending ? undefined : onClose} aria-hidden="true" />
      <form
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto"
        onSubmit={(e) => { e.preventDefault(); if (canSubmit(state)) onSend(); }}
      >
        <h4 id="rr-send-title" className="text-base font-semibold text-gray-900">{RR.send.title}</h4>
        {sent ? (
          <>
            <p role="status" className="text-sm text-emerald-700">{RR.send.sent}</p>
            <div className="flex justify-end"><button type="button" onClick={onClose} className={PRIMARY}>{RR.send.close}</button></div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">{RR.send.help}</p>
            <div>
              <label htmlFor="rr-send-email" className="text-sm font-medium text-gray-800">{RR.send.emailLabel}</label>
              <input id="rr-send-email" ref={first} type="email" autoComplete="off" maxLength={254} value={state.email} disabled={sending} onChange={(e) => onEdit('email', e.target.value)} className={`${FIELD} mt-1`} />
            </div>
            <div>
              <label htmlFor="rr-send-name" className="text-sm font-medium text-gray-800">{RR.send.nameLabel}</label>
              <input id="rr-send-name" type="text" autoComplete="off" maxLength={200} value={state.customerName} disabled={sending} onChange={(e) => onEdit('customerName', e.target.value)} className={`${FIELD} mt-1`} />
            </div>
            <div>
              <label htmlFor="rr-send-message" className="text-sm font-medium text-gray-800">{RR.send.messageLabel}</label>
              <textarea id="rr-send-message" rows={4} maxLength={MAX_SEND_MESSAGE} value={state.message} disabled={sending} onChange={(e) => onEdit('message', e.target.value)} className={`${FIELD} mt-1`} />
              <p className="text-xs text-gray-500 mt-1">{RR.send.messageCount(state.message.length, MAX_SEND_MESSAGE)}</p>
            </div>
            {sending && <p role="status" className="text-sm text-gray-600">{RR.send.sending}</p>}
            {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} disabled={sending} className={BUTTON}>{RR.send.cancel}</button>
              <button type="submit" disabled={sending || !canSubmit(state)} aria-busy={sending || undefined} className={PRIMARY}>
                {sending ? RR.send.sending : state.phase === 'failed' ? RR.send.tryAgain : RR.send.submit}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
