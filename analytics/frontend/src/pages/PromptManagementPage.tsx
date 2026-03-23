import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  usePromptVersions,
  useCreatePrompt,
  useUpdatePrompt,
  usePublishPrompt,
  useSetPromptTesting,
  useStopPromptTesting,
  useComparePrompts,
} from '../hooks/usePrompts';
import { PROMPT_VARIABLES } from '../types/prompts';
import type { PromptVersion, ComparisonMetrics } from '../types/prompts';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROMPT_TYPE_LABELS: Record<string, string> = {
  system_prompt: 'System Prompt',
  capability_explanation: 'Capability Explanation',
};

function promptTypeLabel(type: string): string {
  return PROMPT_TYPE_LABELS[type] ?? type;
}

function sortVersions(versions: PromptVersion[]): PromptVersion[] {
  return [...versions].sort((a, b) => {
    if (a.status === 'published' && b.status !== 'published') return -1;
    if (b.status === 'published' && a.status !== 'published') return 1;
    if (a.status === 'testing' && b.status !== 'testing') return -1;
    if (b.status === 'testing' && a.status !== 'testing') return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function countVariableOccurrences(content: string, varName: string): number {
  const regex = new RegExp(`\\{${varName}\\}`, 'g');
  return (content.match(regex) || []).length;
}

/** Render text with known {variables} highlighted as colored spans. */
function highlightVariables(
  text: string,
  promptType: string,
): React.ReactNode[] {
  const knownVars = (PROMPT_VARIABLES[promptType] ?? []).map((v) => v.name);
  if (knownVars.length === 0) return [text];

  const pattern = new RegExp(`(\\{(?:${knownVars.join('|')})\\})`, 'g');
  const parts = text.split(pattern);

  // Count occurrences for coloring
  const counts: Record<string, number> = {};
  for (const name of knownVars) {
    counts[name] = countVariableOccurrences(text, name);
  }

  return parts.map((part, i) => {
    const match = part.match(/^\{(\w+)\}$/);
    if (match && knownVars.includes(match[1])) {
      const count = counts[match[1]];
      const cls =
        count > 1
          ? 'bg-amber-200 text-amber-800 border border-amber-400 dark:bg-amber-700/60 dark:text-amber-200 dark:border-amber-500/50'
          : 'bg-blue-200 text-blue-800 border border-blue-400 dark:bg-blue-700/60 dark:text-blue-200 dark:border-blue-500/50';
      return (
        <span key={i} className={`${cls} rounded px-1 py-px text-xs`}>
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** LCS-based line diff that correctly handles duplicates and ordering. */
function computeLineDiff(
  textA: string,
  textB: string,
): { linesA: { text: string; type: 'same' | 'removed' }[]; linesB: { text: string; type: 'same' | 'added' }[] } {
  const a = textA.split('\n');
  const b = textB.split('\n');

  // Build LCS table
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to find which lines are common
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matchedA.add(i - 1);
      matchedB.add(j - 1);
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return {
    linesA: a.map((line, idx) => ({
      text: line,
      type: matchedA.has(idx) ? 'same' as const : 'removed' as const,
    })),
    linesB: b.map((line, idx) => ({
      text: line,
      type: matchedB.has(idx) ? 'same' as const : 'added' as const,
    })),
  };
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

// ── Status badge ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  published:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  testing:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  draft:
    'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  archived:
    'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}
    >
      {status}
    </span>
  );
}

// ── Confirm dialog (inline) ─────────────────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded text-sm font-medium text-white ${confirmColor}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Version Dialog ──────────────────────────────────────────────────────

function NewVersionDialog({
  open,
  promptType,
  setPromptType,
  name,
  setName,
  onConfirm,
  onCancel,
  isPending,
}: {
  open: boolean;
  promptType: string;
  setPromptType: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          New Prompt Version
        </h3>
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
              Prompt Type
            </label>
            <select
              value={promptType}
              onChange={(e) => setPromptType(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {Object.keys(PROMPT_VARIABLES).map((key) => (
                <option key={key} value={key}>
                  {promptTypeLabel(key)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
              Version Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. v3-concise-tone"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!name.trim() || isPending}
            className="px-3 py-1.5 rounded text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isPending ? 'Creating...' : 'Create Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Variable Chips ──────────────────────────────────────────────────────────

function VariableChips({
  promptType,
  content,
}: {
  promptType: string;
  content: string;
}) {
  const vars = PROMPT_VARIABLES[promptType];
  if (!vars || vars.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Template Variables
      </div>
      <div className="flex flex-wrap gap-2">
        {vars.map((v) => {
          const count = countVariableOccurrences(content, v.name);
          let chipStyle: string;
          if (count === 0) {
            chipStyle =
              'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500';
          } else if (count === 1) {
            chipStyle =
              'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
          } else {
            chipStyle =
              'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
          }
          return (
            <span
              key={v.name}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${chipStyle}`}
              title={v.description}
            >
              {`{${v.name}}`}
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/60 dark:bg-black/20 text-[10px] font-bold leading-none">
                {count}
              </span>
            </span>
          );
        })}
      </div>
      <div className="text-[11px] text-slate-400 dark:text-slate-500">
        Not used / Used once / Used multiple times / Hover for description
      </div>
    </div>
  );
}

// ── Metrics bar ─────────────────────────────────────────────────────────────

function MetricsBar({ metrics }: { metrics: ComparisonMetrics | null }) {
  if (!metrics || metrics.total_sessions === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        No metrics yet — set as testing and use Test Agent to generate data
      </div>
    );
  }

  const items = [
    { label: 'IDK Rate', value: formatPercent(metrics.idk_rate) },
    { label: 'Escalation Rate', value: formatPercent(metrics.escalation_rate) },
    { label: 'Avg Duration', value: formatDuration(metrics.avg_duration) },
    {
      label: 'Avg Q/Session',
      value: metrics.avg_questions_per_session.toFixed(1),
    },
    { label: 'Avg Tokens', value: Math.round(metrics.avg_tokens).toLocaleString() },
    { label: 'Sessions', value: metrics.total_sessions.toString() },
  ];

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {item.label}
          </div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Diff Panels ─────────────────────────────────────────────────────────────

function DiffPanels({ versionA, versionB }: { versionA: PromptVersion; versionB: PromptVersion }) {
  const { linesA, linesB } = useMemo(
    () => computeLineDiff(versionA.content, versionB.content),
    [versionA.content, versionB.content],
  );

  function renderLines(lines: { text: string; type: string }[]) {
    return lines.map((line, i) => {
      let bg = '';
      if (line.type === 'removed') bg = 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200';
      if (line.type === 'added') bg = 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200';
      return (
        <div key={i} className={`${bg} px-1 min-h-[1.4em]`}>
          {line.text || '\u00A0'}
        </div>
      );
    });
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-4 flex-1 min-h-0">
      <div className="flex flex-col min-h-0">
        <div className="rounded-t-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
          {versionA.name} ({versionA.status})
        </div>
        <div className="flex-1 min-h-[300px] max-h-[500px] overflow-auto rounded-b-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 font-mono whitespace-pre-wrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {renderLines(linesA)}
        </div>
      </div>
      <div className="flex flex-col min-h-0">
        <div className="rounded-t-lg bg-yellow-500 px-3 py-1.5 text-xs font-semibold text-white">
          {versionB.name} ({versionB.status})
        </div>
        <div className="flex-1 min-h-[300px] max-h-[500px] overflow-auto rounded-b-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 font-mono whitespace-pre-wrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {renderLines(linesB)}
        </div>
      </div>
    </div>
  );
}

// ── Comparison View ─────────────────────────────────────────────────────────

function ComparisonView({
  versionA,
  versionB,
  metricsData,
  metricsLoading,
  onExit,
}: {
  versionA: PromptVersion;
  versionB: PromptVersion;
  metricsData: ComparisonMetrics[] | undefined;
  metricsLoading: boolean;
  onExit: () => void;
}) {
  const metricsA = metricsData?.find(
    (m) => m.prompt_version_id === versionA.id
  );
  const metricsB = metricsData?.find(
    (m) => m.prompt_version_id === versionB.id
  );

  const smallSampleWarning =
    (metricsA && metricsA.total_sessions < 30) ||
    (metricsB && metricsB.total_sessions < 30);

  function diffCell(valA: number, valB: number, lowerIsBetter: boolean) {
    const diff = valB - valA;
    if (Math.abs(diff) < 0.001) {
      return (
        <span className="text-slate-500 dark:text-slate-400">--</span>
      );
    }
    const improved = lowerIsBetter ? diff < 0 : diff > 0;
    const color = improved
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-amber-600 dark:text-amber-400';
    const sign = diff > 0 ? '+' : '';
    return <span className={`font-medium ${color}`}>{sign}{diff.toFixed(3)}</span>;
  }

  const metricRows = [
    {
      label: 'IDK Rate',
      a: metricsA?.idk_rate,
      b: metricsB?.idk_rate,
      format: formatPercent,
      lowerIsBetter: true,
    },
    {
      label: 'Escalation Rate',
      a: metricsA?.escalation_rate,
      b: metricsB?.escalation_rate,
      format: formatPercent,
      lowerIsBetter: true,
    },
    {
      label: 'Avg Duration',
      a: metricsA?.avg_duration,
      b: metricsB?.avg_duration,
      format: formatDuration,
      lowerIsBetter: true,
    },
    {
      label: 'Avg Q/Session',
      a: metricsA?.avg_questions_per_session,
      b: metricsB?.avg_questions_per_session,
      format: (v: number) => v.toFixed(1),
      lowerIsBetter: false,
    },
    {
      label: 'Sessions',
      a: metricsA?.total_sessions,
      b: metricsB?.total_sessions,
      format: (v: number) => v.toString(),
      lowerIsBetter: false,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Comparison header */}
      <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 dark:bg-amber-900/20 dark:border-amber-800">
        <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Comparing:{' '}
          <span className="font-semibold">{versionA.name}</span>{' '}
          <StatusBadge status={versionA.status} /> vs{' '}
          <span className="font-semibold">{versionB.name}</span>{' '}
          <StatusBadge status={versionB.status} />
        </div>
        <button
          onClick={onExit}
          className="px-3 py-1.5 rounded text-sm font-medium border border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          Exit Compare
        </button>
      </div>

      {/* Side-by-side text panels with diff */}
      <DiffPanels versionA={versionA} versionB={versionB} />

      {/* Metrics comparison table */}
      <div className="mt-4">
        {metricsLoading ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Loading comparison metrics...
          </div>
        ) : (
          <>
            {smallSampleWarning && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                One or both versions have fewer than 30 sessions. Results may not
                be statistically significant.
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Metric
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {versionA.name}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {versionB.name}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Diff
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {metricRows.map((row) => (
                    <tr key={row.label}>
                      <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-300">
                        {row.label}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                        {row.a != null ? row.format(row.a) : '--'}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                        {row.b != null ? row.format(row.b) : '--'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {row.a != null && row.b != null
                          ? diffCell(row.a, row.b, row.lowerIsBetter)
                          : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Editable Editor with synced scroll ───────────────────────────────────────

function EditableEditor({
  content,
  promptType,
  onChange,
}: {
  content: string;
  promptType: string;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  return (
    <div className="relative w-full min-h-[300px] max-h-[60vh] rounded-lg border-2 border-blue-500 focus-within:border-blue-400">
      <div
        ref={overlayRef}
        aria-hidden
        className="absolute inset-0 bg-slate-50 text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-4 py-3 text-sm font-mono whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
      >
        {highlightVariables(content, promptType)}
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        className="relative w-full min-h-[300px] max-h-[60vh] rounded-lg bg-transparent px-4 py-3 text-sm text-transparent font-mono resize-none outline-none caret-slate-900 dark:caret-slate-100"
        spellCheck={false}
      />
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export const PromptManagementPage = () => {
  // ── State ──
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<[number | null, number | null]>([
    null,
    null,
  ]);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNewVersionDialog, setShowNewVersionDialog] = useState(false);
  const [newVersionType, setNewVersionType] = useState('system_prompt');
  const [newVersionName, setNewVersionName] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    label: string;
    color: string;
    action: () => void;
  } | null>(null);

  // ── Queries / mutations ──
  const { data: versions, isLoading, error } = usePromptVersions();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const publishPrompt = usePublishPrompt();
  const setPromptTesting = useSetPromptTesting();
  const stopPromptTesting = useStopPromptTesting();

  const isComparing =
    compareIds[0] !== null && compareIds[1] !== null;

  const { data: compareMetrics, isLoading: compareMetricsLoading } =
    useComparePrompts(
      isComparing ? compareIds[0] : null,
      isComparing ? compareIds[1] : null
    );

  // Also fetch metrics for the selected single version (reuse compare endpoint with self)
  const { data: singleMetrics } = useComparePrompts(
    !isComparing && selectedId !== null ? selectedId : null,
    !isComparing && selectedId !== null ? selectedId : null
  );

  // ── Derived data ──
  const selectedVersion = useMemo(
    () => versions?.find((v) => v.id === selectedId) ?? null,
    [versions, selectedId]
  );

  const compareVersionA = useMemo(
    () => versions?.find((v) => v.id === compareIds[0]) ?? null,
    [versions, compareIds]
  );
  const compareVersionB = useMemo(
    () => versions?.find((v) => v.id === compareIds[1]) ?? null,
    [versions, compareIds]
  );

  const groupedVersions = useMemo(() => {
    if (!versions) return {};
    const groups: Record<string, PromptVersion[]> = {};
    for (const v of versions) {
      if (!groups[v.prompt_type]) groups[v.prompt_type] = [];
      groups[v.prompt_type].push(v);
    }
    for (const key of Object.keys(groups)) {
      groups[key] = sortVersions(groups[key]);
    }
    return groups;
  }, [versions]);

  const currentMetrics: ComparisonMetrics | null = useMemo(() => {
    if (!singleMetrics || !selectedId) return null;
    return singleMetrics.find((m) => m.prompt_version_id === selectedId) ?? null;
  }, [singleMetrics, selectedId]);

  // ── Sync selected version to edit state ──
  useEffect(() => {
    if (selectedVersion) {
      setEditName(selectedVersion.name);
      setEditContent(selectedVersion.content);
      setHasUnsavedChanges(false);
    }
  }, [selectedVersion]);

  // ── Handlers ──
  const handleSelect = useCallback(
    (id: number, shiftKey: boolean) => {
      if (shiftKey) {
        // Shift+click: add to comparison
        handleToggleCompare(id);
        return;
      }
      setSelectedId(id);
      // Clear comparison when selecting single
      setCompareIds([null, null]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareIds]
  );

  const handleToggleCompare = useCallback(
    (id: number) => {
      setCompareIds((prev) => {
        // If already in compare set, remove it
        if (prev[0] === id) return [prev[1], null];
        if (prev[1] === id) return [prev[0], null];
        // Add to first empty slot
        if (prev[0] === null) return [id, prev[1]];
        if (prev[1] === null) return [prev[0], id];
        // Both full, replace second
        return [prev[0], id];
      });
    },
    []
  );

  const isInCompare = useCallback(
    (id: number) => compareIds[0] === id || compareIds[1] === id,
    [compareIds]
  );

  const compareSlotsFull =
    compareIds[0] !== null && compareIds[1] !== null;

  const handleSave = useCallback(async () => {
    if (!selectedId) return;
    await updatePrompt.mutateAsync({
      id: selectedId,
      data: { name: editName, content: editContent },
    });
    setHasUnsavedChanges(false);
  }, [selectedId, editName, editContent, updatePrompt]);

  const handlePublish = useCallback(() => {
    if (!selectedId) return;
    setConfirmAction({
      title: 'Publish Prompt Version',
      message:
        'Publishing this version will archive the current published version. This action cannot be undone. Continue?',
      label: 'Publish',
      color: 'bg-emerald-600 hover:bg-emerald-500',
      action: async () => {
        await publishPrompt.mutateAsync(selectedId);
        setConfirmAction(null);
      },
    });
  }, [selectedId, publishPrompt]);

  const handleSetTesting = useCallback(async () => {
    if (!selectedId) return;
    await setPromptTesting.mutateAsync(selectedId);
  }, [selectedId, setPromptTesting]);

  const handleStopTesting = useCallback(() => {
    if (!selectedId) return;
    setConfirmAction({
      title: 'Stop Testing',
      message:
        'This will revert the prompt version status back to draft. Any ongoing test sessions using this version will not be affected. Continue?',
      label: 'Stop Test',
      color: 'bg-red-600 hover:bg-red-500',
      action: async () => {
        await stopPromptTesting.mutateAsync(selectedId);
        setConfirmAction(null);
      },
    });
  }, [selectedId, stopPromptTesting]);

  const handleCloneAsDraft = useCallback(async () => {
    if (!selectedVersion) return;
    await createPrompt.mutateAsync({
      prompt_type: selectedVersion.prompt_type,
      name: `${selectedVersion.name} (copy)`,
      content: selectedVersion.content,
    });
  }, [selectedVersion, createPrompt]);

  const handleCreateNew = useCallback(async () => {
    if (!newVersionName.trim()) return;
    const result = await createPrompt.mutateAsync({
      prompt_type: newVersionType,
      name: newVersionName.trim(),
      content: '',
    });
    setShowNewVersionDialog(false);
    setNewVersionName('');
    setSelectedId(result.id);
    setCompareIds([null, null]);
  }, [newVersionType, newVersionName, createPrompt]);

  const handleContentChange = useCallback(
    (value: string) => {
      setEditContent(value);
      if (selectedVersion) {
        setHasUnsavedChanges(value !== selectedVersion.content || editName !== selectedVersion.name);
      }
    },
    [selectedVersion, editName]
  );

  const handleNameChange = useCallback(
    (value: string) => {
      setEditName(value);
      if (selectedVersion) {
        setHasUnsavedChanges(editContent !== selectedVersion.content || value !== selectedVersion.name);
      }
    },
    [selectedVersion, editContent]
  );

  const isEditable =
    selectedVersion?.status === 'draft' ||
    selectedVersion?.status === 'testing';

  // ── Render ──
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Prompt Management
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage, test, and compare prompt versions for the agent.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          Failed to load prompt versions. Please try again.
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            Loading prompt versions...
          </div>
        </div>
      ) : !versions || versions.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8 dark:border-slate-700 dark:bg-slate-900">
          <div className="text-lg font-semibold text-slate-700 dark:text-slate-300">
            No prompt versions yet
          </div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Create your first prompt version to get started.
          </p>
          <button
            onClick={() => setShowNewVersionDialog(true)}
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-500"
          >
            + New Version
          </button>
        </div>
      ) : (
        /* Main list-detail layout */
        <div className="flex flex-1 gap-4 min-h-0">
          {/* ── Left panel: Tree sidebar ── */}
          <div className="w-72 flex-shrink-0 flex flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {/* New Version button */}
            <div className="border-b border-slate-200 dark:border-slate-800 p-3">
              <button
                onClick={() => setShowNewVersionDialog(true)}
                className="w-full px-3 py-1.5 rounded text-sm font-medium text-white bg-blue-600 hover:bg-blue-500"
              >
                + New Version
              </button>
            </div>

            {/* Tree content */}
            <div className="flex-1 overflow-y-auto p-2">
              {Object.entries(groupedVersions).map(
                ([promptType, groupVersions]) => {
                  const isCollapsed = collapsedGroups[promptType] ?? false;
                  return (
                    <div key={promptType} className="mb-1">
                      {/* Group header */}
                      <button
                        onClick={() =>
                          setCollapsedGroups((prev) => ({
                            ...prev,
                            [promptType]: !prev[promptType],
                          }))
                        }
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                      >
                        <svg
                          className={`h-3 w-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        {promptTypeLabel(promptType)}
                        <span className="ml-auto text-slate-400 dark:text-slate-500">
                          {groupVersions.length}
                        </span>
                      </button>

                      {/* Group items */}
                      {!isCollapsed && (
                        <div className="ml-2 space-y-0.5">
                          {groupVersions.map((v) => {
                            const isSelected = selectedId === v.id;
                            const inCompare = isInCompare(v.id);
                            const isHovered = hoveredId === v.id;
                            const showPlus =
                              !inCompare &&
                              !compareSlotsFull &&
                              isHovered;
                            const showMinus = inCompare && isHovered;

                            return (
                              <div
                                key={v.id}
                                className={`group flex items-center gap-1.5 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                                  isSelected && !isComparing
                                    ? 'bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
                                    : inCompare
                                    ? 'bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'
                                    : 'hover:bg-slate-50 border border-transparent dark:hover:bg-slate-800'
                                }`}
                                onMouseEnter={() => setHoveredId(v.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                onClick={(e) => handleSelect(v.id, e.shiftKey)}
                              >
                                {/* Compare +/- button */}
                                <div className="w-5 flex-shrink-0 flex items-center justify-center">
                                  {inCompare ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleCompare(v.id);
                                      }}
                                      className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                                        showMinus
                                          ? 'bg-red-500 text-white'
                                          : 'bg-amber-400 text-white'
                                      }`}
                                      title="Remove from comparison"
                                    >
                                      {showMinus ? '-' : '+'}
                                    </button>
                                  ) : showPlus ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleCompare(v.id);
                                      }}
                                      className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold bg-slate-300 text-white hover:bg-blue-500 dark:bg-slate-600 dark:hover:bg-blue-500"
                                      title="Add to comparison"
                                    >
                                      +
                                    </button>
                                  ) : null}
                                </div>

                                {/* Name + meta */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                                      {v.name}
                                    </span>
                                    <StatusBadge status={v.status} />
                                  </div>
                                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                    {relativeTime(v.updated_at)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
              )}
            </div>

            {/* Hint at bottom */}
            <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2">
              <div className="text-[11px] text-slate-400 dark:text-slate-500">
                Shift+click or use + to compare two versions
              </div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="flex-1 min-w-0 flex flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 overflow-y-auto">
            {isComparing && compareVersionA && compareVersionB ? (
              <ComparisonView
                versionA={compareVersionA}
                versionB={compareVersionB}
                metricsData={compareMetrics}
                metricsLoading={compareMetricsLoading}
                onExit={() => setCompareIds([null, null])}
              />
            ) : selectedVersion ? (
              <>
                {/* Header: breadcrumb + name + status */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                      {promptTypeLabel(selectedVersion.prompt_type)} / v
                      {selectedVersion.version}
                    </div>
                    <div className="flex items-center gap-2">
                      {isEditable ? (
                        <input
                          value={editName}
                          onChange={(e) => handleNameChange(e.target.value)}
                          className="text-lg font-semibold text-slate-900 bg-transparent border-b border-slate-300 outline-none focus:border-blue-500 dark:text-white dark:border-slate-600 dark:focus:border-blue-400"
                        />
                      ) : (
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                          {selectedVersion.name}
                        </h2>
                      )}
                      <StatusBadge status={selectedVersion.status} />
                      {hasUnsavedChanges && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                          Unsaved changes
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {selectedVersion.status === 'draft' && (
                      <>
                        <button
                          onClick={handleSetTesting}
                          disabled={setPromptTesting.isPending}
                          className="px-3 py-1.5 rounded text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50"
                        >
                          Set as Testing
                        </button>
                        <button
                          onClick={handlePublish}
                          disabled={publishPrompt.isPending}
                          className="px-3 py-1.5 rounded text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                        >
                          Publish
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={
                            !hasUnsavedChanges || updatePrompt.isPending
                          }
                          className="px-3 py-1.5 rounded text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {updatePrompt.isPending ? 'Saving...' : 'Save'}
                        </button>
                      </>
                    )}
                    {selectedVersion.status === 'testing' && (
                      <>
                        <button
                          onClick={handleStopTesting}
                          disabled={stopPromptTesting.isPending}
                          className="px-3 py-1.5 rounded text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50"
                        >
                          Stop Test
                        </button>
                        <button
                          onClick={handlePublish}
                          disabled={publishPrompt.isPending}
                          className="px-3 py-1.5 rounded text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                        >
                          Publish
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={
                            !hasUnsavedChanges || updatePrompt.isPending
                          }
                          className="px-3 py-1.5 rounded text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {updatePrompt.isPending ? 'Saving...' : 'Save'}
                        </button>
                      </>
                    )}
                    {(selectedVersion.status === 'published' ||
                      selectedVersion.status === 'archived') && (
                      <button
                        onClick={handleCloneAsDraft}
                        disabled={createPrompt.isPending}
                        className="px-3 py-1.5 rounded text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        {createPrompt.isPending
                          ? 'Cloning...'
                          : 'Clone as Draft'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Editor */}
                <div className="mt-4 flex-1 flex flex-col min-h-0">
                  <div className="relative flex-1">
                    {!isEditable && (
                      <div className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-700/80 text-slate-300">
                        read-only
                      </div>
                    )}
                    {isEditable ? (
                      <EditableEditor
                        content={editContent}
                        promptType={selectedVersion.prompt_type}
                        onChange={handleContentChange}
                      />
                    ) : (
                      /* Read-only: scrollable with max height */
                      <div
                        className="w-full min-h-[300px] max-h-[60vh] overflow-y-auto rounded-lg bg-slate-50 text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-4 py-3 text-sm font-mono whitespace-pre-wrap break-words border border-slate-200 dark:border-slate-700"
                      >
                        {highlightVariables(editContent, selectedVersion.prompt_type)}
                      </div>
                    )}
                  </div>

                  {/* Variable highlighting */}
                  <VariableChips
                    promptType={selectedVersion.prompt_type}
                    content={editContent}
                  />

                  {/* Metrics bar */}
                  {selectedVersion.status === 'draft' ? (
                    <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      No metrics yet — set as testing and use Test Agent to
                      generate data
                    </div>
                  ) : (
                    <MetricsBar metrics={currentMetrics} />
                  )}
                </div>
              </>
            ) : (
              /* No selection state */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-slate-400 dark:text-slate-500 text-sm">
                    Select a prompt version from the sidebar to view or edit it.
                  </div>
                  <div className="text-slate-400 dark:text-slate-500 text-xs mt-2">
                    Or use Shift+click / + buttons to compare two versions.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <NewVersionDialog
        open={showNewVersionDialog}
        promptType={newVersionType}
        setPromptType={setNewVersionType}
        name={newVersionName}
        setName={setNewVersionName}
        onConfirm={handleCreateNew}
        onCancel={() => {
          setShowNewVersionDialog(false);
          setNewVersionName('');
        }}
        isPending={createPrompt.isPending}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel={confirmAction?.label ?? ''}
        confirmColor={confirmAction?.color ?? ''}
        onConfirm={confirmAction?.action ?? (() => {})}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
