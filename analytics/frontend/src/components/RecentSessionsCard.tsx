import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RecentSession } from '../hooks/useMetrics';

interface Props {
  sessions?: RecentSession[];
  loading?: boolean;
}

export const RecentSessionsCard = ({ sessions, loading }: Props) => {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const navigate = useNavigate();

  const containsHebrew = (text: string | null | undefined): boolean => {
    if (!text) return false;
    // Hebrew Unicode range: \u0590-\u05FF
    return /[\u0590-\u05FF]/.test(text);
  };

  if (loading) {
    return <div className="text-slate-500 dark:text-slate-400">Loading recent sessions...</div>;
  }

  if (!sessions?.length) {
    return <div className="text-slate-500 dark:text-slate-400">No recent sessions available.</div>;
  }

  const toggleSession = (sessionId: string) => {
    setExpandedSessionId((current) => (current === sessionId ? null : sessionId));
  };

  const countIdkAnswers = (interactions: typeof sessions[0]['interactions']) => {
    return interactions.filter((interaction) =>
      interaction.answer.toLowerCase().includes('idk')
    ).length;
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recent Sessions</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Most recent five sessions ordered by latest interaction.</p>
          </div>
          <button
            onClick={() => navigate('/chat-history')}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600"
          >
            Full Chat History
          </button>
        </div>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {sessions.map((session) => {
          const isExpanded = expandedSessionId === session.sessionId;
          const idkCount = countIdkAnswers(session.interactions);
          const formattedTime = formatTime(session.lastQuestionTime);

          return (
            <li key={session.sessionId} className="text-sm text-slate-700 dark:text-slate-200">
              <button
                type="button"
                onClick={() => toggleSession(session.sessionId)}
                className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-slate-50 focus:outline-none dark:hover:bg-slate-900/60"
              >
                <div className="flex items-center gap-4">
                  {formattedTime && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formattedTime}
                    </span>
                  )}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">
                        {session.userId || 'Unknown User'}
                      </span>
                      {session.theme && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">• {session.theme}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={session.hasSupportRequest ? "rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800 dark:bg-red-900/30 dark:text-red-300" : "invisible rounded-full px-3 py-1 text-xs font-semibold"}>
                    Support Request Opened
                  </span>
                  <span className={idkCount > 0 ? "rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" : "invisible rounded-full px-3 py-1 text-xs font-semibold"}>
                    IDK: {idkCount || 0}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {session.interactions.length} messages
                  </span>
                </div>
              </button>
              {isExpanded ? (
                <div className="space-y-4 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
                  {session.interactions.map((interaction) => (
                    <div key={interaction.id} className="space-y-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Question</p>
                        <p 
                          className={`text-sm text-slate-700 dark:text-slate-200 ${containsHebrew(interaction.question) ? 'text-right' : ''}`}
                          dir={containsHebrew(interaction.question) ? 'rtl' : 'auto'}
                        >
                          {interaction.question}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Answer</p>
                        <p 
                          className={`text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap ${containsHebrew(interaction.answer) ? 'text-right' : ''}`}
                          dir={containsHebrew(interaction.answer) ? 'rtl' : 'auto'}
                        >
                          {interaction.answer}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
