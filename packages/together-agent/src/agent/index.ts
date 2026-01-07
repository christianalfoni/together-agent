import express from 'express';
import { router } from './routes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/prompt', router);

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
});
