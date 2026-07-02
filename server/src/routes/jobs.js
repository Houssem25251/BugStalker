import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs, results } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { analyzeCode } from '../agentClient.js';
import { fetchRepoFiles, parseRepoUrl } from '../github.js';

const router = Router();

// Every job route requires a logged-in user.
router.use(requireAuth);

const createJobSchema = z.object({
  inputType: z.enum(['paste', 'file', 'repo']),
  inputRef: z.string().min(1, 'inputRef is required'),
  language: z.string().optional().default(''),
});

async function setStatus(jobId, status) {
  await db.update(jobs).set({ status, updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

// Analyze one snippet (paste or uploaded file content).
async function processSnippet(job) {
  const analysis = await analyzeCode({ code: job.inputRef, language: job.language || '' });
  await db.insert(results).values({
    jobId: job.id,
    bugs: analysis.bugs ?? null,
    fixedCode: analysis.fixed_code ?? null,
    verificationStatus: analysis.verification_status ?? null,
    explanation: analysis.explanation ?? null,
    raw: analysis,
  });
}

// Analyze a public GitHub repo: fetch up to a few files, run each through the agent.
async function processRepo(job) {
  const { branch, totalCandidates, files } = await fetchRepoFiles(job.inputRef);
  if (files.length === 0) {
    throw new Error('No analyzable Python/JavaScript files found in this repository.');
  }

  const fileResults = [];
  for (const f of files) {
    // maxAttempts 1 per file to stay inside free-tier limits.
    const analysis = await analyzeCode({ code: f.content, language: f.language, maxAttempts: 1 });
    fileResults.push({ path: f.path, language: f.language, analysis });
  }

  const bugs = fileResults.flatMap((r) =>
    (r.analysis.bugs || []).map((b) => ({ ...b, file: r.path })),
  );
  const buggy = fileResults.filter((r) => (r.analysis.bugs || []).length > 0);
  const allVerified = buggy.every((r) => r.analysis.verification_status === 'passed');

  await db.insert(results).values({
    jobId: job.id,
    bugs,
    verificationStatus: buggy.length === 0 ? 'passed' : allVerified ? 'passed' : 'failed',
    explanation:
      `Analyzed ${fileResults.length} of ${totalCandidates} candidate files on branch "${branch}". ` +
      `Found ${bugs.length} bug(s) across ${buggy.length} file(s).`,
    raw: { branch, totalCandidates, files: fileResults },
  });
}

// Runs in the background after a job is created (fire-and-forget).
async function processJob(job) {
  try {
    await setStatus(job.id, 'running');

    if (job.inputType === 'repo') {
      await processRepo(job);
    } else {
      // 'paste' and 'file' are both code-as-text.
      await processSnippet(job);
    }

    await setStatus(job.id, 'done');
  } catch (err) {
    console.error(`[job ${job.id}] processing failed:`, err.message);
    try {
      await db.insert(results).values({
        jobId: job.id,
        verificationStatus: 'failed',
        explanation: `Error: ${err.message}`,
      });
    } catch {
      /* ignore secondary failure */
    }
    await setStatus(job.id, 'failed');
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

    // Reject bad repo URLs up front instead of failing in the background.
    if (inputType === 'repo' && !parseRepoUrl(inputRef)) {
      return res.status(400).json({ error: 'Not a valid GitHub repository URL (expected https://github.com/owner/repo)' });
    }

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
