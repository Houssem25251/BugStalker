import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// users — the spine of the whole app. Everything else (jobs, results, api_usage)
// will hang off user_id in later steps. For now: just auth.
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});