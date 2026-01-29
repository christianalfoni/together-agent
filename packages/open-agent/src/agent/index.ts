import express from 'express';
import { router } from './routes';
import * as fs from 'fs';
import * as path from 'path';

// Use WORKSPACE_PATH env variable (defaults to current working directory)
const workspacePath = process.env.WORKSPACE_PATH || process.cwd();

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

  // Create/recreate journals directory
  const journalsPath = path.join(toolsPath, 'journals');
  try {
    if (fs.existsSync(journalsPath)) {
      fs.rmSync(journalsPath, { recursive: true, force: true });
    }
    fs.mkdirSync(journalsPath, { recursive: true });
    console.log('✓ Initialized journals directory');
  } catch (err) {
    console.error('✗ Failed to initialize journals directory:', err);
  }
}

// Export workspace path, tools path, and custom prompt for use in routes
export { workspacePath, toolsPath, customAgentPrompt };

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
