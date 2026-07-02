import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs, results } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { analyzeCode } from '../agentClient.js';

const router = Router();

// Every job route requires a logged-in user.
router.use(requireAuth);

const createJobSchema = z.object({
  inputType: z.enum(['paste', 'file', 'repo']),
  inputRef: z.string().min(1, 'inputRef is required'),
  language: z.string().optional().default(''),
});

// Runs in the background after a job is created (fire-and-forget).
// Flips status queued -> running -> done/failed and stores the result.
async function processJob(job) {
  try {
    await db.update(jobs).set({ status: 'running', updatedAt: new Date() }).where(eq(jobs.id, job.id));

    if (job.inputType !== 'paste') {
      // file/repo ingestion isn't wired yet (that's Step 6).
      await db.insert(results).values({
        jobId: job.id,
        verificationStatus: 'failed',
        explanation: `Input type "${job.inputType}" is not supported yet.`,
      });
      await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id));
      return;
    }

    // Call the Python agent. inputRef holds the pasted code.
    const analysis = await analyzeCode({ code: job.inputRef, language: job.language || '' });

    await db.insert(results).values({
      jobId: job.id,
      bugs: analysis.bugs ?? null,
      fixedCode: analysis.fixed_code ?? null,
      verificationStatus: analysis.verification_status ?? null,
      explanation: analysis.explanation ?? null,
      raw: analysis,
    });

    await db.update(jobs).set({ status: 'done', updatedAt: new Date() }).where(eq(jobs.id, job.id));
  } catch (err) {
    console.error(`[job ${job.id}] processing failed:`, err.message);
    try {
      await db.insert(results).values({
        jobId: job.id,
        verificationStatus: 'failed',
        explanation: `Agent error: ${err.message}`,
      });
    } catch {
      /* ignore secondary failure */
    }
    await db.update(jobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(jobs.id, job.id));
  }
}

// POST /jobs — create a job, respond immediately, run the agent in the background.
router.post('/', async (req, res, next) => {
  try {
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    }
    const { inputType, inputRef, language } = parsed.data;

    const [job] = await db
      .insert(jobs)
      .values({ userId: req.user.id, inputType, inputRef, language })
      .returning();

    // Respond right away; the slow agent work happens in the background.
    res.status(201).json({ job });
    processJob(job).catch((err) => console.error(`[job ${job.id}] unhandled:`, err));
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

// GET /jobs/:id — fetch one job + its result (poll this to watch it finish).
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

    const [result] = await db.select().from(results).where(eq(results.jobId, id));
    return res.json({ job, result: result ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
