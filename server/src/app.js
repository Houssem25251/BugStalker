import express from 'express';
import authRoutes from './routes/auth.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/auth', authRoutes);

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