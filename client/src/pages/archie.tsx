import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PRODUCT_NAME, useCompany } from '../lib/company';
import Chat from './chat';

interface Msg { id: string; role: 'user' | 'assistant'; content: string; toolsUsed?: string[]; isError?: boolean; retryText?: string; }

/** Starter questions; `state` is the company's state, so the permit question is about where it works. */
const chipsFor = (state: string): { label: string; text: string; min: 'production' | 'sales' | 'manager' | 'admin' }[] => [
  { label: "This week's schedule", text: "What's on the schedule this week?", min: 'production' },
  { label: 'New leads', text: 'Show me the newest leads', min: 'sales' },
  { label: 'Open proposals', text: 'Which proposals are still open?', min: 'sales' },
  { label: 'Who owes us money', text: 'Who still owes us money?', min: 'manager' },
  { label: 'Win rate', text: "What's our win rate this month?", min: 'manager' },
  { label: 'Bills due', text: 'What bills are due?', min: 'admin' },
  // What the Advisor knows beyond the company's own data — open to everyone.
  { label: 'Permit rules', text: `When does a reroof need a permit${state ? ` in ${state}` : ' here'}?`, min: 'production' },
  { label: 'ACV vs RCV', text: 'Explain ACV and RCV on an insurance claim in plain words.', min: 'production' },
];
const RANK = { production: 0, sales: 1, manager: 2, admin: 3 } as const;

export default function Archie() {
  const { user } = useAuth();
  const company = useCompany();
  const [mode, setMode] = useState<'archie' | 'advisors'>('archie');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  // send() had no unmount guard — switching pages while a response was still
  // in flight kept calling setMessages/setLoading after this component was gone.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Restore today's thread (it resets on its own each day — yesterday is saved
  // as a summary the assistant can recall).
  useEffect(() => {
    api.get<{ messages: { role: string; content: string }[] }>('/api/agent-chats/today?agent=advisor')
      .then((r) => {
        const prior = (r.messages || []).map((m, i) => ({ id: `h${i}`, role: m.role as 'user' | 'assistant', content: m.content }));
        if (prior.length) setMessages(prior);
      })
      .catch(() => {});
  }, []);

  const role = (user?.role ?? 'production') as keyof typeof RANK;
  const chips = chipsFor(company.state).filter((c) => RANK[role] >= RANK[c.min]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setMessages((m) => [...m, { id: Date.now().toString(), role: 'user', content }]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.post<{ response: string; toolsUsed?: string[] }>('/api/archie/chat', { message: content });
      if (!mounted.current) return;
      setMessages((m) => [...m, { id: Date.now() + '_a', role: 'assistant', content: res.response, toolsUsed: res.toolsUsed }]);
    } catch {
      if (!mounted.current) return;
      setMessages((m) => [...m, { id: Date.now() + '_e', role: 'assistant', content: 'Sorry — I hit an error. Please try again.', isError: true, retryText: content }]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  if (mode === 'advisors') {
    return (
      <div>
        <button onClick={() => setMode('archie')} className="mb-4 text-sm text-blue-600 hover:underline">← Back to the Advisor</button>
        <Chat initialAgent={null} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden>🤖</span>
          <div><h2 className="font-semibold text-gray-900 text-base leading-tight">{PRODUCT_NAME} Advisor</h2><p className="text-sm text-gray-500">{company.id ? `${company.displayName} team assistant` : 'Your team assistant'}</p></div>
        </div>
        <button onClick={() => setMode('advisors')} className="text-sm text-gray-500 hover:text-gray-700">Talk to advisors →</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            <p className="text-lg mb-2">👋 Hi! I'm your {PRODUCT_NAME} Advisor.</p>
            <p className="text-sm mb-4">Ask me about your leads, jobs, schedule or money, or about local building code, permits, insurance claims and what we offer.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {chips.map((c) => (
                <button key={c.label} onClick={() => send(c.text)} className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100">{c.label}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-4 ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.toolsUsed && m.toolsUsed.length > 0 && (
                <p className="text-[11px] text-gray-400 mt-2 border-t border-gray-200 pt-1.5">Checked: {m.toolsUsed.join(', ').replace(/_/g, ' ')}</p>
              )}
              {m.isError && (
                <button onClick={() => send(m.retryText)} disabled={loading} className="text-xs font-medium underline mt-2 disabled:opacity-50 disabled:cursor-not-allowed">Retry</button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg p-4">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask your advisor…"
            rows={1}
            disabled={loading}
            aria-label="Ask your advisor"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
          />
          <button onClick={() => send()} disabled={loading || !input.trim()} className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">Send</button>
        </div>
      </div>
    </div>
  );
}
