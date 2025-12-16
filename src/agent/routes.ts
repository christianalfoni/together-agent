import { Router } from 'express';

export const router = Router();

router.post('/execute', (req, res) => {
  const { action, payload } = req.body;

  // Agent logic will go here
  res.json({
    success: true,
    action,
    result: `Executed action: ${action}`,
    timestamp: new Date().toISOString()
  });
});

router.get('/status', (req, res) => {
  res.json({
    agent: 'together-agent',
    version: '0.1.0',
    status: 'ready'
  });
});
