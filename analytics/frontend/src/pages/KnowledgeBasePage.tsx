import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

type KnowledgeBaseItem = {
  id: number;
  url: string;
  type: string;
  question: string | null;
  answer: string | null;
  categories: string[] | null;
  date_added: string;
};

type Draft = {
  question: string;
  answer: string;
  url: string;
  categories: string;
};

const emptyDraft: Draft = {
  question: '',
  answer: '',
  url: '',
  categories: '',
};

const toCategoryList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const formatDate = (value: string) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

export const KnowledgeBasePage = () => {
  const [items, setItems] = useState<KnowledgeBaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [isIncompleteExpanded, setIsIncompleteExpanded] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'none'>('none');

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/knowledge-base');
      setItems(response.data.items ?? []);
    } catch (err) {
      setError('טעינת מאגר הידע נכשלה.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    let result = items;
    if (term) {
      result = items.filter((item) => {
        const haystack = [
          item.id,
          item.question ?? '',
          item.answer ?? '',
          item.url ?? '',
          item.type ?? '',
          (item.categories ?? []).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      });
    }
    if (sortOrder !== 'none') {
      result = [...result].sort((a, b) => {
        const dateA = new Date(a.date_added).getTime();
        const dateB = new Date(b.date_added).getTime();
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      });
    }
    return result;
  }, [items, search, sortOrder]);

  const completeItems = useMemo(
    () =>
      filteredItems.filter(
        (item) => (item.question ?? '').trim() && (item.answer ?? '').trim()
      ),
    [filteredItems]
  );

  const incompleteItems = useMemo(
    () =>
      filteredItems.filter(
        (item) => !(item.question ?? '').trim() || !(item.answer ?? '').trim()
      ),
    [filteredItems]
  );

  const startEdit = (item: KnowledgeBaseItem) => {
    setEditingId(item.id);
    setEditDraft({
      question: item.question ?? '',
      answer: item.answer ?? '',
      url: item.url ?? '',
      categories: (item.categories ?? []).join(', '),
    });
  };

  const canSaveDraft = (draft: Draft) =>
    draft.question.trim().length > 0 && draft.answer.trim().length > 0;

  const handleCreate = async () => {
    if (!canSaveDraft(newDraft)) {
      setError('שאלה ותשובה הן שדות חובה.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        question: newDraft.question.trim(),
        answer: newDraft.answer.trim(),
        url: newDraft.url.trim() || null,
        categories: toCategoryList(newDraft.categories),
      };
      const response = await api.post('/knowledge-base', payload);
      setItems((prev) => [response.data, ...prev]);
      setNewDraft(emptyDraft);
      setIsAdding(false);
    } catch (err) {
      setError('הוספת פריט למאגר הידע נכשלה.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (editingId === null) return;
    if (!canSaveDraft(editDraft)) {
      setError('שאלה ותשובה הן שדות חובה.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        question: editDraft.question.trim(),
        answer: editDraft.answer.trim(),
        url: editDraft.url.trim() || null,
        categories: toCategoryList(editDraft.categories),
      };
      const response = await api.put(`/knowledge-base/${editingId}`, payload);
      setItems((prev) =>
        prev.map((item) => (item.id === editingId ? response.data : item))
      );
      setEditingId(null);
    } catch (err) {
      setError('עדכון פריט במאגר הידע נכשל.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div dir="rtl" className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">מאגר ידע</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              ניהול תוכן עבור הבוט (CustomerSupportChatbotData).
            </p>
          </div>
          <button
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            onClick={() => setIsAdding((prev) => !prev)}
          >
            הוספה +
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="חיפוש לפי שאלה, תשובה, URL או קטגוריות..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-right text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-500"
          />
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as 'asc' | 'desc' | 'none')}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-right text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-500"
          >
            <option value="none">ללא מיון</option>
            <option value="desc">נערך לאחרונה (חדש לישן)</option>
            <option value="asc">נערך לאחרונה (ישן לחדש)</option>
          </select>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {items.length} פריטים
          </div>
        </div>

        {isAdding && (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  שאלה
                </label>
                <textarea
                  value={newDraft.question}
                  onChange={(event) =>
                    setNewDraft((prev) => ({ ...prev, question: event.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  תשובה
                </label>
                <textarea
                  value={newDraft.answer}
                  onChange={(event) =>
                    setNewDraft((prev) => ({ ...prev, answer: event.target.value }))
                  }
                  rows={4}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  URL
                </label>
                <input
                  value={newDraft.url}
                  onChange={(event) =>
                    setNewDraft((prev) => ({ ...prev, url: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  קטגוריות (מופרדות בפסיקים)
                </label>
                <input
                  value={newDraft.categories}
                  onChange={(event) =>
                    setNewDraft((prev) => ({ ...prev, categories: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={handleCreate}
                disabled={!canSaveDraft(newDraft) || isSaving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                שמירה
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          טוען פריטי מאגר ידע...
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">פריטים מלאים</h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {completeItems.length} פריטים
              </span>
            </div>
            {completeItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                אין פריטים מלאים לפי החיפוש.
              </div>
            ) : (
              <div className="space-y-4">
                {completeItems.map((item) => {
                  const isEditing = editingId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    >
                      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex-1 text-center">
                          {isEditing ? (
                            <div className="space-y-3 text-right">
                              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                שאלה
                              </label>
                              <textarea
                                value={editDraft.question}
                                onChange={(event) =>
                                  setEditDraft((prev) => ({
                                    ...prev,
                                    question: event.target.value,
                                  }))
                                }
                                rows={3}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              />
                              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                תשובה
                              </label>
                              <textarea
                                value={editDraft.answer}
                                onChange={(event) =>
                                  setEditDraft((prev) => ({
                                    ...prev,
                                    answer: event.target.value,
                                  }))
                                }
                                rows={4}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              />
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                {item.question || 'שאלה ללא כותרת'}
                              </div>
                              <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                {item.answer || 'ללא תשובה'}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="w-full max-w-sm space-y-3 text-sm text-slate-600 dark:text-slate-400">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                              ID
                            </span>
                            <span>{item.id}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                              Type
                            </span>
                            <span>{item.type}</span>
                          </div>
                          {isEditing ? (
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  URL
                                </label>
                                <input
                                  value={editDraft.url}
                                  onChange={(event) =>
                                    setEditDraft((prev) => ({
                                      ...prev,
                                      url: event.target.value,
                                    }))
                                  }
                                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  קטגוריות
                                </label>
                                <input
                                  value={editDraft.categories}
                                  onChange={(event) =>
                                    setEditDraft((prev) => ({
                                      ...prev,
                                      categories: event.target.value,
                                    }))
                                  }
                                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                  URL
                                </span>
                                <span className="break-all text-slate-700 dark:text-slate-300">
                                  {item.url}
                                </span>
                              </div>
                              <div className="flex flex-col gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                  קטגוריות
                                </span>
                                {item.categories && item.categories.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {item.categories.map((category) => (
                                      <span
                                        key={category}
                                        className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                      >
                                        {category}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span>—</span>
                                )}
                              </div>
                            </>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                              נערך לאחרונה
                            </span>
                            <span>{formatDate(item.date_added)}</span>
                          </div>
                          <div className="pt-2">
                            {isEditing ? (
                              <button
                                onClick={handleUpdate}
                                disabled={!canSaveDraft(editDraft) || isSaving}
                                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                              >
                                שמירה
                              </button>
                            ) : (
                              <button
                                onClick={() => startEdit(item)}
                                className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                              >
                                עריכה
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <button
              onClick={() => setIsIncompleteExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">פריטים חסרים</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {incompleteItems.length} פריטים
                </span>
              </div>
              <svg
                className={`h-5 w-5 text-slate-500 transition-transform dark:text-slate-400 ${isIncompleteExpanded ? 'rotate-180' : ''
                  }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {isIncompleteExpanded && (
              <>
                {incompleteItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    אין פריטים חסרים.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {incompleteItems.map((item) => {
                      const isEditing = editingId === item.id;
                      return (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm transition hover:border-amber-300 dark:border-amber-900/60 dark:bg-amber-950/30"
                        >
                          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                            <div className="flex-1 text-center">
                              {isEditing ? (
                                <div className="space-y-3 text-right">
                                  <label className="block text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                    שאלה
                                  </label>
                                  <textarea
                                    value={editDraft.question}
                                    onChange={(event) =>
                                      setEditDraft((prev) => ({
                                        ...prev,
                                        question: event.target.value,
                                      }))
                                    }
                                    rows={3}
                                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                  <label className="block text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                    תשובה
                                  </label>
                                  <textarea
                                    value={editDraft.answer}
                                    onChange={(event) =>
                                      setEditDraft((prev) => ({
                                        ...prev,
                                        answer: event.target.value,
                                      }))
                                    }
                                    rows={4}
                                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-slate-900 dark:text-slate-100"
                                  />
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                    {item.question || 'חסרה שאלה'}
                                  </div>
                                  <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                    {item.answer || 'חסרה תשובה'}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="w-full max-w-sm space-y-3 text-sm text-slate-600 dark:text-slate-400">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                  ID
                                </span>
                                <span>{item.id}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                  Type
                                </span>
                                <span>{item.type}</span>
                              </div>
                              {isEditing ? (
                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                      URL
                                    </label>
                                    <input
                                      value={editDraft.url}
                                      onChange={(event) =>
                                        setEditDraft((prev) => ({
                                          ...prev,
                                          url: event.target.value,
                                        }))
                                      }
                                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                      קטגוריות
                                    </label>
                                    <input
                                      value={editDraft.categories}
                                      onChange={(event) =>
                                        setEditDraft((prev) => ({
                                          ...prev,
                                          categories: event.target.value,
                                        }))
                                      }
                                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                      URL
                                    </span>
                                    <span className="break-all text-slate-700 dark:text-slate-300">
                                      {item.url}
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-2">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                      קטגוריות
                                    </span>
                                    {item.categories && item.categories.length > 0 ? (
                                      <div className="flex flex-wrap gap-2">
                                        {item.categories.map((category) => (
                                          <span
                                            key={category}
                                            className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                          >
                                            {category}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span>—</span>
                                    )}
                                  </div>
                                </>
                              )}
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                                  נערך לאחרונה
                                </span>
                                <span>{formatDate(item.date_added)}</span>
                              </div>
                              <div className="pt-2">
                                {isEditing ? (
                                  <button
                                    onClick={handleUpdate}
                                    disabled={!canSaveDraft(editDraft) || isSaving}
                                    className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                                  >
                                    שמירה
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => startEdit(item)}
                                    className="w-full rounded-lg border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-900 transition hover:border-amber-300 dark:border-amber-700 dark:text-amber-100 dark:hover:border-amber-500"
                                  >
                                    עריכה
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>

          {filteredItems.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              לא נמצאו פריטים לפי החיפוש.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
