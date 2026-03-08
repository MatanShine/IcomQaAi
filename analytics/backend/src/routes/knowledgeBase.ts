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

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://app:8000';

async function notifyAppRefreshIndex(): Promise<void> {
  try {
    await fetch(`${APP_BASE_URL}/api/v1/refresh_index`);
  } catch (error) {
    console.warn('Failed to notify app to refresh index:', error);
  }
}

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
    notifyAppRefreshIndex();
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
    notifyAppRefreshIndex();
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
    console.error('Error updating knowledge base item:', error);
    // Log the full error for debugging
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
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

knowledgeBaseRouter.post('/discovery', async (req, res, next) => {
  try {
    const { types } = req.body;
    if (!types || !Array.isArray(types) || types.length === 0) {
      return res.status(400).json({ error: 'types array is required (cs, pm, yt)' });
    }
    const response = await fetch(`${APP_BASE_URL}/api/v1/run_discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ types }),
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Failed to run discovery:', error);
    res.status(502).json({ error: 'Failed to reach app service for discovery' });
  }
});

