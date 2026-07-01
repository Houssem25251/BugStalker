import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

// Neon's HTTP driver: simplest fit for a request/response Express service.
// (No long-lived connections, no pooling to manage. Upgrade to the
// websocket/serverless driver later if we need transactions.)
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });