import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Every job route requires a logged-in user.
router.use(requireAuth);

const createJobSchema = z.object({
  inputType: z.enum(['paste', 'file', 'repo']),
  inputRef: z.string().min(1, 'inputRef is required'),
});

// POST /jobs — queue a new analysis job for the current user.
router.post('/', async (req, res, next) => {
  try {
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    }
    const { inputType, inputRef } = parsed.data;

    // status defaults to 'queued' — the agent will move it forward later.
    const [job] = await db
      .insert(jobs)
      .values({ userId: req.user.id, inputType, inputRef })
      .returning();

    return res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

// GET /jobs — list the current user's jobs, newest first.
router.get('/', async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.userId, req.user.id))
      .orderBy(desc(jobs.createdAt));
    return res.json({ jobs: rows });
  } catch (err) {
    next(err);
  }
});

// GET /jobs/:id — fetch one job, but only if it belongs to the current user.
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid job id' });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.userId, req.user.id)));

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    return res.json({ job });
  } catch (err) {
    next(err);
  }
});

export default router;
