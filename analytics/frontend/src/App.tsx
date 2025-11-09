import { useEffect, useMemo, useState } from 'react';

type QARecord = {
  id: number;
  question: string;
  answer: string;
  dateAsked: string;
};

const API_BASE_URL = import.meta.env.VITE_ANALYTICS_API_BASE_URL ?? 'http://localhost:4001';

function App() {
  const [records, setRecords] = useState<QARecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/analytics/qa`);
        if (!response.ok) {
          throw new Error('Failed to load analytics');
        }
        const payload = await response.json();
        setRecords(payload.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const headline = useMemo(() => {
    if (isLoading) {
      return 'Loading insights…';
    }

    if (error) {
      return 'We hit a snag fetching the latest insights';
    }

    if (records.length === 0) {
      return 'No conversations captured yet';
    }

    return 'Latest conversations with Support AI';
  }, [isLoading, error, records.length]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="text-sm font-semibold uppercase tracking-[0.35em] text-sky-400">Analytics</span>
          <h1 className="text-4xl font-semibold text-white md:text-5xl">Support Intelligence Dashboard</h1>
          <p className="text-slate-300 md:w-2/3">
            Keep a pulse on what customers ask and how the AI responds. This lightweight dashboard
            highlights the freshest interactions to inspire the next wave of insights.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl shadow-sky-950/40 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">{headline}</h2>

          {isLoading && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-40 animate-pulse rounded-2xl bg-slate-800/70"
                />
              ))}
            </div>
          )}

          {!isLoading && error && (
            <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-200">
              <h3 className="text-lg font-semibold">Something went wrong</h3>
              <p>{error}</p>
            </div>
          )}

          {!isLoading && !error && records.length === 0 && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-300">
              <p>We&apos;ll surface new conversations as soon as customers start chatting.</p>
            </div>
          )}

          {!isLoading && !error && records.length > 0 && (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {records.map((record) => (
                <article
                  key={record.id}
                  className="group relative overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-lg transition-transform duration-300 hover:-translate-y-1 hover:border-sky-500/60 hover:shadow-sky-900/50"
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-500/60 to-transparent" />
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Question</p>
                  <p className="mt-2 text-lg font-medium text-sky-100">{record.question}</p>
                  <p className="mt-6 text-xs uppercase tracking-[0.3em] text-slate-400">AI Answer</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{record.answer}</p>
                  <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
                    <span>#{record.id}</span>
                    <time dateTime={record.dateAsked}>
                      {new Date(record.dateAsked).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
