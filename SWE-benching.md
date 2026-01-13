# Running SWE-bench with TypeScript Agents

A practical guide for evaluating long-running coding agents using SWE-bench.

## What is SWE-bench?

SWE-bench is the gold standard benchmark for evaluating AI coding agents on real-world software engineering tasks. It contains actual GitHub issues from popular open-source repositories (Django, Flask, sympy, etc.) and evaluates whether your agent can generate patches that fix these issues.

### How it Works

1. **Dataset**: Real GitHub issues with the exact repo state at that point in time
2. **Your Agent**: Generates a patch to fix the issue
3. **Evaluation**: SWE-bench applies your patch in a Docker container and runs tests
4. **Success**: Tests pass after your patch is applied

### Variants

- **SWE-bench Lite**: 300 tasks (good starting point)
- **SWE-bench**: 2,294 tasks (full dataset)
- **SWE-bench Pro**: 1,865 long-horizon tasks (hardest, best for testing context management)
- **SWE-bench Verified**: Curated subset with verified test quality

## Why Use It?

Perfect for testing:
- Long-running agent capabilities
- Context management and compression
- Multi-file editing
- Real-world problem solving

The hardest tasks take 4+ hours and require understanding large codebases.

## The TypeScript Approach

**Good news**: You can build everything in TypeScript except the final evaluation step.

**Bad news**: SWE-bench's evaluation harness is Python-only.

**Solution**: Run your agent in TypeScript, generate diffs programmatically, then call the Python evaluator.

## Setup

### Prerequisites

```bash
# 1. Install Python evaluation harness (one time)
pip install swebench

# 2. Make sure Docker is installed and running
# SWE-bench needs Docker to run tests in isolated environments

# 3. System requirements:
# - 120GB+ free storage (Docker images are large)
# - 16GB+ RAM
# - 8+ CPU cores recommended
```

### Get the Dataset

The dataset is available on HuggingFace as JSON/Parquet:

```python
# Option 1: Download with Python (one time)
from datasets import load_dataset
dataset = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
dataset.to_json("swe_bench_lite.json")
```

```bash
# Option 2: Direct download
wget https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite/resolve/main/data/test-00000-of-00001.parquet
```

### Dataset Structure

Each task contains everything you need:

```json
{
  "instance_id": "django__django-12345",
  "repo": "django/django",
  "base_commit": "abc123def456...",
  "problem_statement": "The login view doesn't handle...",
  "hints_text": "Optional hints",
  "test_patch": "Tests that verify the fix",
  "created_at": "2021-03-15T10:30:00Z"
}
```

## The Workflow

### High-Level Process

```
1. Load SWE-bench task from dataset
2. Clone the repo at the specific commit
3. Run your agent with the problem statement
4. Extract git diff of all changes
5. Format as JSONL prediction
6. Run Python evaluation harness
```

### Complete TypeScript Implementation

```typescript
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

interface SWEBenchTask {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
}

interface Prediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

async function runAgentOnTask(
  task: SWEBenchTask,
  agent: YourAgentType
): Promise<Prediction> {
  // 1. Setup workspace
  const workspace = `/tmp/swe-bench-${task.instance_id}`;

  // Clean up if exists
  execSync(`rm -rf ${workspace}`, { stdio: 'ignore' });

  // Clone the repo at the specific commit
  console.log(`Cloning ${task.repo} at ${task.base_commit.slice(0, 7)}...`);
  execSync(`git clone https://github.com/${task.repo} ${workspace}`);
  execSync(`git checkout ${task.base_commit}`, { cwd: workspace });

  // 2. Run your agent
  console.log(`Running agent on: ${task.problem_statement.slice(0, 80)}...`);
  await agent.solve({
    instruction: task.problem_statement,
    workspace: workspace,
    hints: task.hints_text
  });

  // 3. Generate the diff
  const diff = execSync('git diff HEAD', {
    cwd: workspace,
    encoding: 'utf-8'
  });

  if (!diff.trim()) {
    console.warn(`Warning: No changes made for ${task.instance_id}`);
  }

  // 4. Return prediction
  return {
    instance_id: task.instance_id,
    model_name_or_path: 'my-agent-v1',
    model_patch: diff
  };
}

async function evaluateSWEBench(
  datasetPath: string,
  agent: YourAgentType,
  options: {
    maxTasks?: number;
    outputPath?: string;
  } = {}
) {
  const {
    maxTasks = 5,
    outputPath = 'predictions.jsonl'
  } = options;

  // Load dataset
  const tasks: SWEBenchTask[] = JSON.parse(
    await fs.readFile(datasetPath, 'utf-8')
  );

  console.log(`Loaded ${tasks.length} tasks from ${datasetPath}`);
  console.log(`Running on first ${maxTasks} tasks...`);

  const predictions: Prediction[] = [];

  // Process tasks
  for (const task of tasks.slice(0, maxTasks)) {
    console.log(`\n[${predictions.length + 1}/${maxTasks}] ${task.instance_id}`);

    try {
      const prediction = await runAgentOnTask(task, agent);
      predictions.push(prediction);
    } catch (error) {
      console.error(`Failed on ${task.instance_id}:`, error);
      // Continue with next task
    }
  }

  // Write predictions as JSONL
  const jsonl = predictions.map(p => JSON.stringify(p)).join('\n');
  await fs.writeFile(outputPath, jsonl);

  console.log(`\nWrote ${predictions.length} predictions to ${outputPath}`);

  // Run evaluation
  console.log('\nRunning SWE-bench evaluation...');
  execSync(
    `python -m swebench.harness.run_evaluation \
      --predictions_path ${outputPath} \
      --max_workers 4 \
      --run_id my_evaluation_run`,
    { stdio: 'inherit' }
  );
}

// Usage
const agent = new YourAgent();
await evaluateSWEBench('./swe_bench_lite.json', agent, {
  maxTasks: 5,
  outputPath: 'my_predictions.jsonl'
});
```

## Manual Testing (Start Here)

Test with a single task first:

```typescript
import { execSync } from 'child_process';
import fs from 'fs/promises';

async function testSingleTask() {
  // Example task from sympy
  const task = {
    instance_id: "sympy__sympy-20590",
    repo: "sympy/sympy",
    base_commit: "d60497958c8f6a5119ff6fad5b15b1395d8a697c",
    problem_statement: "Fix the printing of multiplications..."
  };

  const workspace = '/tmp/test-sympy';

  // 1. Clone and checkout
  execSync(`rm -rf ${workspace}`);
  execSync(`git clone https://github.com/${task.repo} ${workspace}`);
  execSync(`git checkout ${task.base_commit}`, { cwd: workspace });

  // 2. Run your agent
  await yourAgent.solve({
    instruction: task.problem_statement,
    workspace: workspace
  });

  // 3. Get diff
  const diff = execSync('git diff HEAD', {
    cwd: workspace,
    encoding: 'utf-8'
  });

  console.log('Generated diff:');
  console.log(diff);

  // 4. Save prediction
  await fs.writeFile('test_prediction.jsonl', JSON.stringify({
    instance_id: task.instance_id,
    model_name_or_path: 'my-agent',
    model_patch: diff
  }) + '\n');

  // 5. Evaluate (this will build Docker image and run tests)
  execSync(
    `python -m swebench.harness.run_evaluation \
      --predictions_path test_prediction.jsonl \
      --instance_ids ${task.instance_id} \
      --max_workers 1`,
    { stdio: 'inherit' }
  );
}

testSingleTask();
```

## How Your Agent Integrates

Your agent just needs to work with a filesystem workspace:

```typescript
class YourAgent {
  async solve(options: {
    instruction: string;
    workspace: string;
    hints?: string;
  }) {
    // Your agent's normal workflow:
    // 1. Read files in workspace
    // 2. Understand the problem
    // 3. Make edits using your tools
    // 4. Create new files if needed

    // The workspace is a git repo, so all changes
    // are automatically tracked

    // Example with your existing tools:
    const files = await this.findRelevantFiles(
      options.workspace,
      options.instruction
    );

    for (const file of files) {
      const content = await this.readFile(file);
      const updated = await this.llm.edit(content, options.instruction);
      await this.writeFile(file, updated);
    }
  }
}
```

**Key insight**: Your agent doesn't need to know about SWE-bench at all. It just:
1. Receives a workspace directory (a git repo)
2. Receives an instruction
3. Makes file changes
4. The orchestration code handles extracting the diff

## Evaluation Output

After running evaluation, you'll get:

```json
{
  "instance_id": "django__django-12345",
  "resolved": true,
  "test_results": {
    "passed": 15,
    "failed": 0
  }
}
```

Results are saved in a `logs/` directory with detailed information about:
- Which tests passed/failed
- Docker build logs
- Execution traces

## Tips & Best Practices

### Start Small
- Begin with 1 task to test your setup
- Then try 5-10 tasks
- Scale up once everything works

### Choose Your Subset Wisely
```typescript
// Filter by repository
const djangoTasks = tasks.filter(t => t.repo.includes('django'));

// Filter by date (older = easier usually)
const earlierTasks = tasks.filter(t =>
  new Date(t.created_at) < new Date('2020-01-01')
);

// Start with shorter problem statements
const simpleTasks = tasks
  .sort((a, b) => a.problem_statement.length - b.problem_statement.length)
  .slice(0, 10);
```

### Handle Failures Gracefully
```typescript
try {
  const prediction = await runAgentOnTask(task, agent);
  predictions.push(prediction);
} catch (error) {
  console.error(`Failed on ${task.instance_id}:`, error);
  // Save failed task for later analysis
  await fs.appendFile('failed_tasks.json',
    JSON.stringify({ task, error: String(error) }) + '\n'
  );
}
```

### Monitor Resource Usage
```typescript
// Clean up workspaces to save disk space
async function cleanup(workspace: string) {
  execSync(`rm -rf ${workspace}`);
}

// Limit concurrent evaluations (they're resource-heavy)
const maxWorkers = Math.min(os.cpus().length / 2, 4);
```

## Validation

Test your setup with gold patches first:

```bash
# This validates that Docker images build correctly
python -m swebench.harness.run_evaluation \
  --instance_ids sympy__sympy-20590 \
  --predictions_path gold \
  --run_id validate-gold
```

If gold patches pass, your setup is correct.

## Alternative: Cloud Evaluation

If you don't want to run evaluation locally:

```bash
# Install sb-cli for remote evaluation
pip install sb-cli

# Submit predictions for cloud evaluation
sb-cli submit predictions.jsonl --benchmark SWE-bench_Lite
```

This offloads the heavy Docker evaluation to the cloud.

## Performance Baselines

As of January 2026:
- **SWE-bench Lite**: Top models achieve 60-70%
- **SWE-bench**: Top models achieve ~50%
- **SWE-bench Pro**: Top models (GPT-5, Claude Opus 4.5) achieve ~23%

Even 10-20% on SWE-bench Lite is respectable for a new agent.

## Resources

- [SWE-bench GitHub](https://github.com/SWE-bench/SWE-bench)
- [Official Documentation](https://www.swebench.com/SWE-bench/)
- [Dataset on HuggingFace](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite)
- [Evaluation Guide](https://www.swebench.com/SWE-bench/guides/evaluation/)
- [Docker Setup Guide](https://www.swebench.com/SWE-bench/guides/docker_setup/)

## Summary

1. **Download dataset**: One-time JSON/Parquet download from HuggingFace
2. **Install evaluator**: `pip install swebench` (only Python dependency)
3. **Run agent**: Your TypeScript agent works normally on cloned repos
4. **Extract diffs**: Use `git diff` to capture all changes
5. **Evaluate**: Call Python evaluator with predictions JSONL
6. **Iterate**: Review results and improve your agent

The beauty of this approach: 95% of your code is TypeScript. Python is just for the final evaluation step.
