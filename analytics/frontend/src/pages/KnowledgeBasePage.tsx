import { useEffect, useMemo, useState } from 'react';
import { kbApi } from '../lib/kbApi';

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

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await kbApi.get('/knowledge-base');
      setItems(response.data.items ?? []);
    } catch (err) {
      setError('Failed to load knowledge base items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
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
  }, [items, search]);

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
      setError('Question and answer are required.');
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
      const response = await kbApi.post('/knowledge-base', payload);
      setItems((prev) => [response.data, ...prev]);
      setNewDraft(emptyDraft);
      setIsAdding(false);
    } catch (err) {
      setError('Failed to add knowledge base item.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (editingId === null) return;
    if (!canSaveDraft(editDraft)) {
      setError('Question and answer are required.');
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
      const response = await kbApi.put(`/knowledge-base/${editingId}`, payload);
      setItems((prev) =>
        prev.map((item) => (item.id === editingId ? response.data : item))
      );
      setEditingId(null);
    } catch (err) {
      setError('Failed to update knowledge base item.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Knowledge Base</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Manage CustomerSupportChatbotData entries.
            </p>
          </div>
          <button
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            onClick={() => setIsAdding((prev) => !prev)}
          >
            Add +
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search questions, answers, URLs, categories..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-500"
            />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {items.length} total items
          </div>
        </div>

        {isAdding && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Question
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
                  Answer
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
                  Categories (comma-separated)
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
                Save
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
          Loading knowledge base...
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex-1 text-center">
                    {isEditing ? (
                      <div className="space-y-3 text-left">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Question
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
                          Answer
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
                          {item.question || 'Untitled question'}
                        </div>
                        <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                          {item.answer || 'No answer provided.'}
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
                            Categories
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
                            Categories
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
                        Added
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
                          Save
                        </button>
                      ) : (
                        <button
                          onClick={() => startEdit(item)}
                          className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredItems.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              No knowledge base entries match your search.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
