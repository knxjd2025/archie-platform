import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { ADVISOR_FOCUS } from '../../../shared/advisors';

interface Agent {
  id: number;
  name: string;
  role: string;
  title: string;
  avatar: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  timestamp: Date;
  isError?: boolean;
  retryText?: string;
}

interface Props {
  initialAgent?: string | null;
}

export default function Chat({ initialAgent }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentsError, setAgentsError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Which send is current. Switching advisors while a reply was pending used
  // to drop the old advisor's answer into the new advisor's chat, so a reply
  // only lands if nothing has been sent or switched since it was asked.
  const sendSeq = useRef(0);

  useEffect(() => {
    sendSeq.current += 1;
    setLoading(false);
  }, [selectedAgent?.role]);

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (initialAgent && agents.length > 0) {
      const agent = agents.find(a => a.role === initialAgent);
      if (agent) setSelectedAgent(agent);
    }
  }, [initialAgent, agents]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadAgents = async () => {
    setAgentsError(false);
    try {
      const res = await api.get<Agent[]>('/api/agents');
      setAgents(res);
      if (!selectedAgent && res.length > 0) {
        setSelectedAgent(res[0]);
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
      setAgentsError(true);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = async (resendText?: string) => {
    const content = (resendText ?? input).trim();
    if (!content || !selectedAgent || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    if (!resendText) setInput('');
    setLoading(true);
    const seq = ++sendSeq.current;

    try {
      const res = await api.post<{ response: string; toolsUsed?: string[] }>(`/api/agents/${selectedAgent.role}/chat`, {
        message: userMessage.content,
      });
      if (seq !== sendSeq.current) return;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.response,
        toolsUsed: res.toolsUsed,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      if (seq !== sendSeq.current) return;
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date(),
          isError: true,
          retryText: userMessage.content,
        },
      ]);
    } finally {
      if (seq === sendSeq.current) setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectAgent = (agent: Agent) => {
    if (messages.length > 0 && !window.confirm('Switch agents? This conversation will be cleared.')) {
      return;
    }
    setSelectedAgent(agent);
    setMessages([]);
  };

  return (
    // 100vh on iOS is the height with the toolbars hidden, so the input sat
    // under Safari's bottom bar; dvh tracks the space actually on screen.
    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 h-[calc(100vh-10rem)] supports-[height:100dvh]:h-[calc(100dvh-10rem)]">
      {/* Agent Selector — capped on a phone, where the full list of advisors
          and quick questions pushed the chat panel to zero height. */}
      <div className="w-full sm:w-64 flex-shrink-0 max-h-[40%] sm:max-h-none bg-white rounded-xl shadow-sm border border-gray-200 p-4 overflow-y-auto">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Select Agent
        </h2>
        {agentsError && agents.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">Couldn't load advisors.</p>
            <button onClick={loadAgents} className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium">Retry</button>
          </div>
        ) : agents.length === 0 ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />)}</div>
        ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                selectedAgent?.id === agent.id
                  ? 'bg-blue-50 border-2 border-blue-500'
                  : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
              }`}
            >
              <span className="text-2xl" aria-hidden>{agent.avatar}</span>
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{agent.name}</p>
                <p className="text-xs text-gray-500 truncate">{agent.title}</p>
                {ADVISOR_FOCUS[agent.role] && <p className="text-[11px] text-gray-400 leading-snug mt-0.5">{ADVISOR_FOCUS[agent.role]}</p>}
              </div>
            </button>
          ))}
        </div>
        )}

        {/* Quick Actions */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Quick Questions
          </h3>
          <div className="space-y-2">
            {selectedAgent?.role === 'ceo' && (
              <>
                <QuickButton onClick={() => setInput("How's the business doing today?")}>
                  Daily Summary
                </QuickButton>
                <QuickButton onClick={() => setInput("What needs my attention?")}>
                  Attention Items
                </QuickButton>
              </>
            )}
            {selectedAgent?.role === 'cmo' && (
              <>
                <QuickButton onClick={() => setInput("Show me the lead pipeline")}>
                  Lead Pipeline
                </QuickButton>
                <QuickButton onClick={() => setInput("How are marketing metrics looking?")}>
                  Marketing Metrics
                </QuickButton>
              </>
            )}
            {selectedAgent?.role === 'sales_manager' && (
              <>
                <QuickButton onClick={() => setInput("What's overdue in my follow-ups?")}>Overdue follow-ups</QuickButton>
                <QuickButton onClick={() => setInput('How are my KPIs this week?')}>My KPIs this week</QuickButton>
                <QuickButton onClick={() => setInput("What's stuck in my pipeline?")}>What's stuck</QuickButton>
                <QuickButton onClick={() => setInput('Where do my commissions stand?')}>My commissions</QuickButton>
              </>
            )}
            {selectedAgent?.role === 'customer_service' && (
              <>
                <QuickButton onClick={() => setInput('Draft a status update text for a customer whose install got pushed by rain.')}>Rain-delay text</QuickButton>
                <QuickButton onClick={() => setInput('Which customers am I overdue getting back to?')}>Who I owe a call</QuickButton>
              </>
            )}
            {selectedAgent?.role === 'coo' && (
              <>
                <QuickButton onClick={() => setInput("What's in production right now and what's stuck?")}>Production board</QuickButton>
                <QuickButton onClick={() => setInput('Which sold jobs have no schedule yet?')}>Sold, not scheduled</QuickButton>
              </>
            )}
            {selectedAgent?.role === 'project_coordinator' && (
              <>
                <QuickButton onClick={() => setInput('List my active jobs and what each one needs next.')}>My active jobs</QuickButton>
                <QuickButton onClick={() => setInput('Draft the "crew arriving tomorrow" text for a job.')}>Crew-arriving text</QuickButton>
              </>
            )}
            {selectedAgent?.role === 'estimator' && (
              <>
                <QuickButton onClick={() => setInput("What's sitting in Estimating for me?")}>In Estimating</QuickButton>
                <QuickButton onClick={() => setInput('Give me good/better/best options for a 28-square architectural replacement.')}>Good / better / best</QuickButton>
              </>
            )}
            {selectedAgent?.role === 'cfo' && (
              <>
                <QuickButton onClick={() => setInput("What's our revenue this month?")}>
                  Monthly Revenue
                </QuickButton>
                <QuickButton onClick={() => setInput("Show outstanding invoices")}>
                  Outstanding Invoices
                </QuickButton>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Chat Header */}
        {selectedAgent && (
          <div className="flex items-center gap-3 p-4 border-b border-gray-200 bg-gray-50">
            <span className="text-3xl" aria-hidden>{selectedAgent.avatar}</span>
            <div>
              <h2 className="font-semibold text-gray-900 text-base leading-tight">{selectedAgent.name}</h2>
              <p className="text-sm text-gray-500">{selectedAgent.title}</p>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 py-12">
              <p className="text-lg mb-2">👋 Hello!</p>
              <p className="text-sm">
                {selectedAgent && ADVISOR_FOCUS[selectedAgent.role]
                  ? `${selectedAgent.name} — ${ADVISOR_FOCUS[selectedAgent.role]}`
                  : `Start a conversation with ${selectedAgent?.name || 'an agent'}. Ask about business metrics, leads, finances, or anything else related to Best Roofing Now.`}
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-4 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.toolsUsed && message.toolsUsed.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200/30">
                    <p className="text-xs opacity-70">
                      Tools used: {message.toolsUsed.join(', ')}
                    </p>
                  </div>
                )}
                {message.isError && (
                  <button
                    onClick={() => sendMessage(message.retryText)}
                    disabled={loading}
                    className="text-xs font-medium underline mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Retry
                  </button>
                )}
                <p className="text-xs opacity-50 mt-1">
                  {message.timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg p-4">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={handleKeyPress}
              aria-label="Message the advisor"
              placeholder={`Message ${selectedAgent?.name || 'agent'}...`}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 max-h-40 overflow-y-auto"
              rows={1}
              disabled={loading || !selectedAgent}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim() || !selectedAgent}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 text-sm text-left text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
    >
      {children}
    </button>
  );
}
