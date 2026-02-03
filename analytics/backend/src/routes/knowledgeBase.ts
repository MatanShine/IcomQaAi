import { Router } from 'express';
import { z } from 'zod';
import {
  getAllKnowledgeBaseItems,
  createKnowledgeBaseItem,
  updateKnowledgeBaseItem,
  getKnowledgeBaseItemById,
} from '../services/knowledgeBaseService';

const createKnowledgeBaseSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  url: z.string().optional().nullable(),
  categories: z.array(z.string()).optional().nullable(),
});

const updateKnowledgeBaseSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  url: z.string().optional().nullable(),
  categories: z.array(z.string()).optional().nullable(),
});

export const knowledgeBaseRouter = Router();

knowledgeBaseRouter.get('/', async (req, res, next) => {
  try {
    const items = await getAllKnowledgeBaseItems();
    // Format items to match FastAPI response structure (date_added as ISO string)
    const formattedItems = items.map((item) => ({
      id: item.id,
      url: item.url,
      type: item.type,
      question: item.question,
      answer: item.answer,
      categories: item.categories || null, // Convert empty array to null for API compatibility
      date_added: item.date_added.toISOString(),
    }));
    res.json({ items: formattedItems });
  } catch (error) {
    next(error);
  }
});

knowledgeBaseRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createKnowledgeBaseSchema.parse(req.body);
    const item = await createKnowledgeBaseItem(parsed);
    // Format response to match FastAPI structure
    res.json({
      id: item.id,
      url: item.url,
      type: item.type,
      question: item.question,
      answer: item.answer,
      categories: (item.categories && item.categories.length > 0) ? item.categories : null, // Convert empty array to null for API compatibility
      date_added: item.date_added.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

knowledgeBaseRouter.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid knowledge base item ID' });
    }
    const parsed = updateKnowledgeBaseSchema.parse(req.body);
    const item = await updateKnowledgeBaseItem(id, parsed);
    // Format response to match FastAPI structure
    res.json({
      id: item.id,
      url: item.url,
      type: item.type,
      question: item.question,
      answer: item.answer,
      categories: (item.categories && item.categories.length > 0) ? item.categories : null, // Convert empty array to null for API compatibility
      date_added: item.date_added.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

knowledgeBaseRouter.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid knowledge base item ID' });
    }
    const item = await getKnowledgeBaseItemById(id);
    if (!item) {
      return res.status(404).json({ error: 'Knowledge base item not found' });
    }
    // Format response to match FastAPI structure
    res.json({
      id: item.id,
      url: item.url,
      type: item.type,
      question: item.question,
      answer: item.answer,
      categories: (item.categories && item.categories.length > 0) ? item.categories : null, // Convert empty array to null for API compatibility
      date_added: item.date_added.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

