import { pgTable, serial, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';

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
// the Python agent will flip this from queued -> running -> done/failed later.
export const jobStatusEnum = pgEnum('job_status', ['queued', 'running', 'done', 'failed']);

// jobs — one analysis request. Created here (Node gateway); later picked up and
// run by the Python agent (step 3+). Results land in a separate `results` table later.
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
