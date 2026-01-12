import express from 'express';
import { router } from './routes';
import * as fs from 'fs';
import * as path from 'path';

// Create workspace folder in the current working directory
const workspacePath = path.join(process.cwd(), 'workspace');
if (!fs.existsSync(workspacePath)) {
  fs.mkdirSync(workspacePath, { recursive: true });
}

// Load custom agent prompt from AGENT.md if it exists in the tools directory
let customAgentPrompt: string | undefined = undefined;
const toolsPath = process.env.TOOLS_PATH;
if (toolsPath) {
  const agentMdPath = path.join(toolsPath, 'AGENT.md');
  if (fs.existsSync(agentMdPath)) {
    try {
      customAgentPrompt = fs.readFileSync(agentMdPath, 'utf-8').trim();
      console.log('✓ Loaded custom agent prompt from AGENT.md');
    } catch (err) {
      console.error('✗ Failed to read AGENT.md:', err);
    }
  }
}

// Export workspace path and custom prompt for use in routes
export { workspacePath, customAgentPrompt };

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Mount the main router at /prompt for prompt and approval endpoints
app.use('/prompt', router);

// Also mount at root to handle /files requests directly
app.use('/', router);

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Agent server running on port ${PORT}`);
});
