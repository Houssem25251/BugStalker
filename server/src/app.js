import express from 'express';
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/auth', authRoutes);
  app.use('/jobs', jobRoutes);

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Centralized error handler (must have 4 args).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
