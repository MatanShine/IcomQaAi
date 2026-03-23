import {
  getAllPromptVersions,
  getPromptVersionById,
  createPromptVersion,
  updatePromptVersion,
  publishPromptVersion,
  setTestingPromptVersion,
  stopTestingPromptVersion,
  getComparisonMetrics,
  seedPromptVersions,
  CreatePromptInput,
  UpdatePromptInput,
  PromptVersionRow,
  ComparisonMetrics,
} from '../db/promptQueries';

export {
  CreatePromptInput,
  UpdatePromptInput,
  PromptVersionRow,
  ComparisonMetrics,
};

export const listPromptVersions = async (promptType?: string): Promise<PromptVersionRow[]> => {
  return getAllPromptVersions(promptType);
};

export const getPromptVersion = async (id: number): Promise<PromptVersionRow | null> => {
  return getPromptVersionById(id);
};

export const createPrompt = async (data: CreatePromptInput): Promise<PromptVersionRow> => {
  return createPromptVersion(data);
};

export const updatePrompt = async (
  id: number,
  data: UpdatePromptInput,
): Promise<PromptVersionRow> => {
  const version = await getPromptVersionById(id);
  if (!version) throw new Error('Prompt version not found');
  if (version.status !== 'draft' && version.status !== 'testing') {
    throw new Error('Only draft and testing versions can be edited');
  }
  return updatePromptVersion(id, data);
};

export const publishPrompt = async (id: number): Promise<PromptVersionRow> => {
  return publishPromptVersion(id);
};

export const setPromptTesting = async (id: number): Promise<PromptVersionRow> => {
  return setTestingPromptVersion(id);
};

export const stopPromptTesting = async (id: number): Promise<PromptVersionRow> => {
  const version = await getPromptVersionById(id);
  if (!version) throw new Error('Prompt version not found');
  if (version.status !== 'testing') {
    throw new Error('Only testing versions can be stopped');
  }
  return stopTestingPromptVersion(id);
};

export const comparePrompts = async (
  idA: number,
  idB: number,
): Promise<ComparisonMetrics[]> => {
  return getComparisonMetrics(idA, idB);
};

export const seedPrompts = async (
  prompts: { prompt_type: string; name: string; content: string }[],
): Promise<PromptVersionRow[]> => {
  return seedPromptVersions(prompts);
};
