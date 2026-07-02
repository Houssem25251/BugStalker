import express from 'express';
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import { pingAgent } from './agentClient.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Connectivity check: can the gateway reach the Python agent?
  app.get('/agent-health', async (req, res) => {
    try {
      const agent = await pingAgent();
      res.json({ gateway: 'ok', agent });
    } catch (err) {
      res.status(502).json({ gateway: 'ok', agent: 'unreachable', error: err.message });
    }
  });

  app.use('/auth', authRoutes);
  app.use('/jobs', jobRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Centralized error handler (must have 4 args).
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
