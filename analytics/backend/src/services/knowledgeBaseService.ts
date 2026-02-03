import {
  getAllKnowledgeBaseItems as getAllKnowledgeBaseItemsQuery,
  createKnowledgeBaseItem as createKnowledgeBaseItemQuery,
  updateKnowledgeBaseItem as updateKnowledgeBaseItemQuery,
  getKnowledgeBaseItemById as getKnowledgeBaseItemByIdQuery,
  CreateKnowledgeBaseInput,
  UpdateKnowledgeBaseInput,
  KnowledgeBaseItem,
} from '../db/queries';

export const getAllKnowledgeBaseItems = async (): Promise<KnowledgeBaseItem[]> => {
  return getAllKnowledgeBaseItemsQuery();
};

export const createKnowledgeBaseItem = async (data: CreateKnowledgeBaseInput): Promise<KnowledgeBaseItem> => {
  return createKnowledgeBaseItemQuery(data);
};

export const updateKnowledgeBaseItem = async (id: number, data: UpdateKnowledgeBaseInput): Promise<KnowledgeBaseItem> => {
  return updateKnowledgeBaseItemQuery(id, data);
};

export const getKnowledgeBaseItemById = async (id: number): Promise<KnowledgeBaseItem | null> => {
  return getKnowledgeBaseItemByIdQuery(id);
};

