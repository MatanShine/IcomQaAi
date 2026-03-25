import { Router } from 'express';
import { z } from 'zod';
import {
  listPromptVersions,
  getPromptVersion,
  createPrompt,
  updatePrompt,
  publishPrompt,
  setPromptTesting,
  stopPromptTesting,
  comparePrompts,
  seedPrompts,
} from '../services/promptService';

const createSchema = z.object({
  prompt_type: z.string().min(1),
  name: z.string().min(1),
  content: z.string().default(''),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().optional(),
});

const querySchema = z.object({
  type: z.string().optional(),
});

const compareSchema = z.object({
  ids: z.string().min(1),
});

const seedSchema = z.object({
  prompts: z.array(
    z.object({
      prompt_type: z.string().min(1),
      name: z.string().min(1),
      content: z.string().min(1),
    }),
  ),
});

export const promptsRouter = Router();

// List all versions, optionally filtered by type
promptsRouter.get('/', async (req, res, next) => {
  try {
    const { type } = querySchema.parse(req.query);
    const versions = await listPromptVersions(type);
    res.json(versions);
  } catch (error) {
    next(error);
  }
});

// Compare two versions (MUST be before /:id)
promptsRouter.get('/compare', async (req, res, next) => {
  try {
    const { ids } = compareSchema.parse(req.query);
    const [idA, idB] = ids.split(',').map((s) => parseInt(s.trim(), 10));
    if (isNaN(idA) || isNaN(idB)) {
      return res.status(400).json({ error: 'ids must be two comma-separated integers' });
    }
    const metrics = await comparePrompts(idA, idB);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

// Get a single version
promptsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await getPromptVersion(id);
    if (!version) return res.status(404).json({ error: 'Not found' });
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Create a new draft
promptsRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const version = await createPrompt(data);
    res.status(201).json(version);
  } catch (error) {
    next(error);
  }
});

// Update a draft or testing version
promptsRouter.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const data = updateSchema.parse(req.body);
    const version = await updatePrompt(id, data);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Publish a version
promptsRouter.post('/:id/publish', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await publishPrompt(id);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Set as testing
promptsRouter.post('/:id/test', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await setPromptTesting(id);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Stop testing
promptsRouter.post('/:id/stop-test', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const version = await stopPromptTesting(id);
    res.json(version);
  } catch (error) {
    next(error);
  }
});

// Seed initial prompts
promptsRouter.post('/seed', async (req, res, next) => {
  try {
    const { prompts } = seedSchema.parse(req.body);
    const created = await seedPrompts(prompts);
    res.json({ seeded: created.length, versions: created });
  } catch (error) {
    next(error);
  }
});
