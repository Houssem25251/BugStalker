import { pgTable, serial, text, integer, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';

// users — the spine of the whole app. Everything else hangs off user_id.
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// How the code to analyze was supplied.
export const inputTypeEnum = pgEnum('input_type', ['paste', 'file', 'repo']);

// Lifecycle of an analysis job. The Postgres row IS the queue for v1 —
// the Python agent will flip this from queued -> running -> done/failed.
export const jobStatusEnum = pgEnum('job_status', ['queued', 'running', 'done', 'failed']);

// jobs — one analysis request. Created by Node; run by the Python agent.
export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  inputType: inputTypeEnum('input_type').notNull(),
  inputRef: text('input_ref').notNull(),
  status: jobStatusEnum('status').notNull().default('queued'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// results — the outcome of one job, produced by the agent's /analyze.
// One row per job (created when the agent finishes).
export const results = pgTable('results', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  bugs: jsonb('bugs'),                              // detected bugs (array of objects)
  fixedCode: text('fixed_code'),                    // the proposed fix
  diff: text('diff'),                               // unified diff (optional, may be null)
  verificationStatus: text('verification_status'),  // "passed" | "failed"
  explanation: text('explanation'),                 // what changed and why
  raw: jsonb('raw'),                                // full agent response (verification detail, attempts, test)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// api_usage — track LLM consumption so free-tier 429s aren't a surprise.
// Placeholder for now; populated once the agent reports token usage.
export const apiUsage = pgTable('api_usage', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),             // "groq" | "gemini"
  tokensUsed: integer('tokens_used').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
