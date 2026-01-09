import express from 'express';
import { router } from './routes';
import * as fs from 'fs';
import * as path from 'path';

// Create workspace folder in the current working directory
const workspacePath = path.join(process.cwd(), 'workspace');
if (!fs.existsSync(workspacePath)) {
  fs.mkdirSync(workspacePath, { recursive: true });
  console.log(`Created workspace at: ${workspacePath}`);
} else {
  console.log(`Using existing workspace at: ${workspacePath}`);
}

// Export workspace path for use in routes
export { workspacePath };

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
