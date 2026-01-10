# Todo Journaling System - Implementation Specification

## Overview

This document outlines the design and implementation of a journaling system for todos in the Together Agent SDK. The system allows LLMs to maintain context across multiple todos by:
1. Isolating messages per todo (each todo has its own conversation thread)
2. Journaling findings to disk during work (fire-and-forget context archival)
3. Retrieving journal context on-demand when needed (brings archived context back)

## Core Concept

**Each todo has an isolated set of messages** and an **optional journal** for archiving context. This solves the context explosion problem: instead of accumulating all messages across all todos, each todo only sees its own messages. Journal content from other todos can be retrieved on-demand via `read_todo_journal`.

### Mental Model

```
Todo List: [
  { description: "Find type errors", completed: true },
  { description: "Fix type errors", completed: false },  ← Current todo (first incomplete)
  { description: "Run tests", completed: false }
]

Message Storage (per-todo):
├─ Todo 0 messages: [user: "find errors", assistant: tool_calls, tool: results, ...]
├─ Todo 1 messages: [user: "fix them", ...]  ← Only these in context for current todo
└─ Todo 2 messages: []

Todo 0 Journal: .todos/todo-0-journal.md
├─ Entry: Starting type check across codebase...
├─ Entry: Found 15 errors in User and Auth modules
└─ Entry: Analyzing error patterns...

Context for Current Todo (1):
  ✓ System message
  ✓ Current todos list
  ✓ Todo 1 messages only
  ✗ Todo 0 messages (hidden, unless journal is read)
```

**Key insight**: Journals are "fire and forget" - they archive context outside the message stream, retrievable only when explicitly read.

## Architecture

### Four-Part System

1. **Native Tool: `write_todos`** - Immutably writes the complete list of todos
   - Takes array: `[{ description: string, completed: boolean }, ...]`
   - Replaces entire todo list on each update
   - First incomplete todo becomes current todo
   - This call is always included in context (not tagged to a specific todo)

2. **Message Scoping** - Each todo has isolated message history
   - Messages generated during a todo's execution are tagged to that todo
   - Context only includes current todo's messages
   - Previous todo messages are hidden (must read journal to access)

3. **Custom Tool: `tools.appendTodoJournal(markdown)`** - Writes to current todo's journal
   - Available during code execution scope
   - Appends to `.todos/todo-{index}-journal.md`
   - Fire-and-forget: Does NOT add to message context
   - Used to archive findings for later retrieval

4. **Native Tool: `read_todo_journal({ todoIndex })`** - Reads journal back
   - Retrieves full markdown content from specified todo's journal
   - Adds journal content as a message to current todo's message array
   - Brings archived context into current conversation

### Message Context Structure

Every LLM request includes (in order):

```typescript
[
  { role: "system", content: "..." },              // Always included
  { role: "assistant", content: [write_todos] },   // Last write_todos call
  ...currentTodoMessages                            // Messages for current todo ONLY
]
```

### Separation of Concerns

| Phase | Component | Purpose |
|-------|-----------|---------|
| **Between turns** | Native tools | Manage todo list, read journals for context |
| **During execution** | Custom tools | Write journals as work progresses (fire-and-forget) |
| **Message filtering** | System | Only show current todo's messages in context |

## How Current Todo is Determined

**Rule**: The first incomplete todo in the array is the current todo.

```typescript
const todos = [
  { description: "Find type errors", completed: true },    // Index 0, completed
  { description: "Fix type errors", completed: false },    // Index 1, CURRENT (first incomplete)
  { description: "Run tests", completed: false }           // Index 2, pending
];

currentTodoIndex = 1; // First incomplete
```

**Current todo changes when**: LLM calls `write_todos()` with different completed states.

```typescript
// LLM marks todo 1 as completed
write_todos([
  { description: "Find type errors", completed: true },
  { description: "Fix type errors", completed: true },     // Now completed
  { description: "Run tests", completed: false }           // Now CURRENT
]);

// System automatically updates: currentTodoIndex = 2
```

## Data Flow

### Turn 1: Creating Todos & Working on First

```
1. User: "Find and fix all type errors"

2. LLM → write_todos([
     { description: "Find type errors", completed: false },
     { description: "Fix type errors", completed: false }
   ])

   System: currentTodoIndex = 0 (first incomplete)

3. LLM → execute_code(`
     await tools.appendTodoJournal("## Starting Type Check\n\nScanning codebase...");

     const errors = await tools.runTypeChecker();

     await tools.appendTodoJournal(\`
## Results

Found \${errors.length} errors across \${errors.filesChecked} files.

### Top Issues:
\${errors.errors.slice(0, 5).map(e => \`- \\\`\${e.file}:\${e.line}\\\` - \${e.message}\`).join('\\n')}
     \`);
   `)

   System: All messages generated are tagged to todoIndex: 0
   System: Journal written to .todos/todo-0-journal.md (NOT added to messages)

4. LLM → write_todos([
     { description: "Find type errors", completed: true },    // Marked complete
     { description: "Fix type errors", completed: false }
   ])

   System: currentTodoIndex = 1 (first incomplete changed)
```

**Message state after Turn 1:**
```typescript
todoMessages = {
  0: [
    { role: "user", content: "Find and fix all type errors" },
    { role: "assistant", content: [write_todos call] },
    { role: "assistant", content: [execute_code call] },
    { role: "tool", content: "Code execution result..." }
  ],
  1: [] // Empty, not worked on yet
}

journals = {
  0: ".todos/todo-0-journal.md" // Contains findings
}
```

### Turn 2: Working on Second Todo

```
Context sent to LLM:
  - System message
  - Last write_todos: [{ "Find type errors", completed: true }, { "Fix type errors", completed: false }]
  - Todo 1 messages: [] (empty - first time working on this todo)

Notice: Todo 0 messages are HIDDEN. Journal exists but not in context.

1. LLM sees empty context for current todo, realizes it needs findings from todo 0

2. LLM → read_todo_journal({ todoIndex: 0 })
   Returns: Full markdown from todo 0's journal
   System: Adds this as a message to todo 1's message array

3. Now LLM has context about what errors were found

4. LLM → execute_code(`
     await tools.appendTodoJournal("## Starting Fixes\n\nWorking on User.ts errors...");

     const fixed = await tools.fixTypeError("user.ts", 10);

     await tools.appendTodoJournal(\`Fixed error at user.ts:10\`);
   `)

   System: All messages tagged to todoIndex: 1
   System: Journal written to .todos/todo-1-journal.md
```

**Message state after Turn 2:**
```typescript
todoMessages = {
  0: [...], // Previous messages, not in context anymore
  1: [
    { role: "assistant", content: [read_todo_journal call] },
    { role: "tool", content: "Journal content from todo 0..." },
    { role: "assistant", content: [execute_code call] },
    { role: "tool", content: "Code execution result..." }
  ]
}

journals = {
  0: ".todos/todo-0-journal.md",
  1: ".todos/todo-1-journal.md"
}
```

### Turn 3: Continuing Work on Same Todo

```
Context sent to LLM:
  - System message
  - Last write_todos: [{ "Find type errors", completed: true }, { "Fix type errors", completed: false }]
  - Todo 1 messages: [read_todo_journal, tool result, execute_code, tool result, ...]

Notice: Journal content from turn 2 is STILL in context (it's in todo 1's messages)

User: "Fix the rest of the errors"

System: Adds user message to todo 1's message array
System: Current todo is still 1 (unchanged)

LLM continues work with full context from previous turn...
```

## Implementation Details

### Initial Todo Setup

**Every user message creates/appends a todo.** The system handles this automatically:

#### First User Message

```typescript
// On first user message
const userMessage = "Find and fix all authentication bugs";

// System automatically creates initial todo
sessionState.todos = [
  {
    description: `Execute user request: ${userMessage}`,
    completed: false
  }
];
sessionState.currentTodoIndex = 0;
sessionState.todoMessages[0] = []; // Initialize message array for todo 0
```

**The LLM sees:**
```typescript
// Context for first turn
[
  { role: "system", content: systemPrompt },
  { role: "assistant", content: [initial write_todos with user's request] },
  { role: "user", content: userMessage }
]

// Todos in context:
[{ description: "Execute user request: Find and fix all authentication bugs", completed: false }]
```

#### Subsequent User Messages (When All Todos Complete)

When all todos are marked complete and the user sends a new message:

```typescript
// Current state: All todos completed
sessionState.todos = [
  { description: "Find authentication bugs", completed: true },
  { description: "Fix authentication bugs", completed: true },
  { description: "Run tests", completed: true }
];
sessionState.currentTodoIndex = -1; // No current todo (all complete)

// User sends new message
const newUserMessage = "Now optimize the database queries";

// System appends new todo to existing list
sessionState.todos.push({
  description: `Execute user request: ${newUserMessage}`,
  completed: false
});

// New todo becomes current
const newTodoIndex = sessionState.todos.length - 1;
sessionState.currentTodoIndex = newTodoIndex;
sessionState.todoMessages[newTodoIndex] = [];

// Result:
sessionState.todos = [
  { description: "Find authentication bugs", completed: true },
  { description: "Fix authentication bugs", completed: true },
  { description: "Run tests", completed: true },
  { description: "Execute user request: Now optimize the database queries", completed: false } // ← New
];
```

**Key behaviors:**
- The agent is ALWAYS working within the todo system
- No "pre-todo" state exists
- Completed todos remain in the list (full history preserved)
- New user requests append to the existing todo list
- Message scoping is always active

### File Storage

```
/workspace/.todos/
├── todo-0-journal.md      # Journal for first todo
├── todo-1-journal.md      # Journal for second todo
└── ...
```

### Todo State Schema

```typescript
interface Todo {
  description: string;  // "Fix type errors"
  completed: boolean;   // true | false
}

type TodoList = Todo[];
```

**No metadata in todos** - Journal existence determined by checking if `.todos/todo-{index}-journal.md` file exists when needed. No separate tracking required.

### Session State Schema

```typescript
// Encapsulates all todo-related state for a session
interface SessionState {
  todos: Todo[];
  currentTodoIndex: number;
  todoMessages: Record<number, CoreMessage[]>;
}

// Initialize session state
const sessionState: SessionState = {
  todos: [],
  currentTodoIndex: -1,
  todoMessages: {}
};

// Helper: Current todo determined by first incomplete
function getCurrentTodoIndex(todos: Todo[]): number {
  return todos.findIndex(t => !t.completed);
}

// Build context for LLM request
function buildContext(sessionState: SessionState): CoreMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: lastWriteTodosCall },
    ...sessionState.todoMessages[sessionState.currentTodoIndex] || []
  ];
}
```

### Journal Format

**Markdown** with freeform structure. LLM chooses organization, but common patterns:

```markdown
## Phase Name

Description of what's happening...

### Subsection

Data or findings:
- Item 1
- Item 2

### Code Snippets

\`\`\`typescript
// Relevant code
\`\`\`

**Decisions**: Why I chose approach X over Y
```

### Custom Tool Implementation

```typescript
// Factory function that closes over session state and workspace path
const createAppendTodoJournalTool = (
  sessionState: SessionState,
  workspacePath: string
) => {
  return async (markdown: string) => {
    const currentTodoIndex = sessionState.currentTodoIndex;
    const journalPath = path.join(workspacePath, `.todos/todo-${currentTodoIndex}-journal.md`);

    try {
      // Fire-and-forget: Write to disk, don't add to messages
      fs.appendFileSync(journalPath, markdown + '\n\n');
    } catch (error) {
      // Silent fail - don't break execution over journaling
      console.warn(`Failed to write journal for todo ${currentTodoIndex}:`, error);
    }
  };
};

// When exposing to execute_code:
const tools = {
  appendTodoJournal: createAppendTodoJournalTool(sessionState, workspacePath),
  // ... other custom tools
};
```

**Design choices:**
- **Silent failures** - Journaling is for context management, not critical functionality. If a journal write fails, execution should continue.
- **No metadata tracking** - Just append to file. Journal existence can be determined by checking if file exists when needed.

### Native Tool: read_todo_journal

```typescript
// Factory function that closes over workspace path
const createReadTodoJournalTool = (workspacePath: string) => ({
  name: "read_todo_journal",
  description: "Read the journal entries for a specific todo to understand previous work",
  inputSchema: z.object({
    todoIndex: z.number().min(0)
  }),
  execute: async ({ todoIndex }: { todoIndex: number }) => {
    const journalPath = path.join(workspacePath, `.todos/todo-${todoIndex}-journal.md`);

    if (!fs.existsSync(journalPath)) {
      return ""; // Empty string if no journal exists
    }

    const markdown = fs.readFileSync(journalPath, 'utf-8');

    // This result becomes a tool message in current todo's message array
    return markdown;
  }
});
```

### Native Tool: write_todos

```typescript
// Factory function that closes over session state and message queue
const createWriteTodosTool = (
  sessionState: SessionState,
  queueMessage: (message: EventMessage) => void
) => ({
  name: "write_todos",
  description: "Write the complete list of todos. Replaces entire todo list.",
  inputSchema: z.object({
    todos: z.array(z.object({
      description: z.string(),
      completed: z.boolean()
    }))
  }),
  execute: async ({ todos }: { todos: Todo[] }) => {
    // Store todos in session state
    sessionState.todos = todos;

    // Determine new current todo
    const currentTodoIndex = todos.findIndex(t => !t.completed);
    sessionState.currentTodoIndex = currentTodoIndex;

    // Initialize message array for new todos if needed
    todos.forEach((_, index) => {
      if (!sessionState.todoMessages[index]) {
        sessionState.todoMessages[index] = [];
      }
    });

    // Send SSE message to update UI
    queueMessage({
      type: "todos_updated",
      todos: todos,
      currentTodoIndex: currentTodoIndex
    });

    return `Updated todos. Current todo: ${currentTodoIndex >= 0 ? todos[currentTodoIndex].description : 'none'}`;
  }
});
```

### SSE Message Types

The system sends Server-Sent Events to update the UI:

```typescript
type EventMessage =
  | { type: "todos_updated"; todos: Todo[]; currentTodoIndex: number }
  | { type: "journal_appended"; todoIndex: number }
  | ... // other existing message types

// Message queue function (from existing SDK)
function queueMessage(message: EventMessage): void {
  // Queues message for SSE stream
}
```

**When messages are sent:**
- `todos_updated` - Every time `write_todos` is called (including automatic user message todos)
- `journal_appended` - When `appendTodoJournal` writes to a file (optional)

### Putting It All Together

```typescript
// Initialize session state
const sessionState: SessionState = {
  todos: [],
  currentTodoIndex: -1,
  todoMessages: {}
};

const workspacePath = "/workspace";

// Create native tools
const writeTodosTool = createWriteTodosTool(sessionState, queueMessage);
const readTodoJournalTool = createReadTodoJournalTool(workspacePath);

// Create custom tools for execute_code
const customTools = {
  appendTodoJournal: createAppendTodoJournalTool(sessionState, workspacePath),
  // ... other custom tools
};

// On first user message, initialize with default todo
const userMessage = "Find and fix authentication bugs";
sessionState.todos = [
  { description: `Execute user request: ${userMessage}`, completed: false }
];
sessionState.currentTodoIndex = 0;
sessionState.todoMessages[0] = [];

// Send initial todos_updated message
queueMessage({
  type: "todos_updated",
  todos: sessionState.todos,
  currentTodoIndex: sessionState.currentTodoIndex
});
```

## Pre-Written Code Execution Model

**Critical understanding**: The LLM generates complete JavaScript code BEFORE execution. It doesn't see intermediate results and regenerate - it must plan everything upfront.

### What This Enables

**Template literals with tool results:**
```javascript
const result = await tools.analyze();
await tools.appendTodoJournal(`Found ${result.count} issues`);
```

**Conditional journaling:**
```javascript
const errors = await tools.runTypeChecker();

if (errors.length > 10) {
  await tools.appendTodoJournal("⚠️ High error count, prioritizing critical ones");
} else {
  await tools.appendTodoJournal("✓ Manageable error count, fixing all now");
}
```

**Data transformation:**
```javascript
const errors = await tools.runTypeChecker();

await tools.appendTodoJournal(`
## Error Distribution

${Object.entries(groupBy(errors, 'file')).map(([file, errs]) =>
  `- ${file}: ${errs.length} errors`
).join('\n')}
`);
```

**Phase-based journaling:**
```javascript
await tools.appendTodoJournal("## Phase 1: Discovery\n\nScanning codebase...");
const errors = await tools.scan();

await tools.appendTodoJournal(`### Results\n\nFound ${errors.length} errors`);

await tools.appendTodoJournal("## Phase 2: Analysis\n\nCategorizing by severity...");
const categorized = categorize(errors);

await tools.appendTodoJournal(`### Categories\n\n${formatCategories(categorized)}`);
```

### LLM's Capabilities

Because the LLM:
1. **Knows all tool output schemas** - Can reference fields confidently
2. **Writes full JavaScript** - Can use loops, conditionals, helper functions
3. **Plans entire execution** - Must think through the full flow upfront

It can create **rich, adaptive journals** that respond to execution results while being written in advance.

### Debugging Benefit

When execution fails, the journal shows exactly how far it got:

```markdown
## Phase 1: Discovery
Scanning codebase...
### Results
Found 15 errors

## Phase 2: Analysis
Categorizing by severity...
[EXECUTION CRASHED - next journal entry never written]
```

This makes debugging LLM execution much easier.

## System Prompt

The following system prompt should be included to teach the LLM how to work with todos and journals:

```markdown
# Todo and Journaling System

You always work within a todo system. Every request starts with an initial todo that you can work on directly or break down into multiple todos.

## How Todos Work

### Message Scoping
- **You only see messages from the current todo** - Your context includes system messages, the current todo list, and messages from the current todo only
- **Previous todo messages are hidden** - You cannot see messages from completed or other pending todos unless you read their journals
- **Fresh context for each todo** - When you move to a new todo, you start with a clean message slate

### Current Todo
The **first incomplete todo** in the list is your current todo. This is the todo you're actively working on.

**Example:**
```javascript
// Current todo list
[
  { description: "Analyze codebase", completed: true },     // Done, messages hidden
  { description: "Fix bugs", completed: false },            // ← CURRENT (first incomplete)
  { description: "Write tests", completed: false }          // Pending
]
```

Your context only includes messages from "Fix bugs" (todo index 1). Messages from "Analyze codebase" are hidden.

### Managing Todos

**Creating/Updating Todos:**
```javascript
write_todos([
  { description: "Find type errors", completed: false },
  { description: "Fix type errors", completed: false },
  { description: "Run tests", completed: false }
]);
```

**Marking a todo complete:**
```javascript
write_todos([
  { description: "Find type errors", completed: true },    // Mark complete
  { description: "Fix type errors", completed: false },    // Now becomes current
  { description: "Run tests", completed: false }
]);
```

When you mark a todo complete, the system automatically switches to the next incomplete todo as current.

### When to Use Single vs Multiple Todos

**Single todo** - For straightforward requests:
- The initial todo is sufficient
- No need to break down into phases
- Example: "Explain how authentication works"

**Multiple todos** - For complex, multi-phase work:
- Clear sequential phases (discover → analyze → fix → test)
- Each phase produces findings needed by next phase
- Want to isolate context per phase
- Example: "Find and fix all bugs" → ["Find bugs", "Fix bugs", "Test fixes"]

**You don't need to create todos just for the sake of it.** If the initial todo works fine, use it.

## Todo Journals

Each todo has an optional journal - a markdown file where you archive findings and context.

### Key Concept: Fire-and-Forget

**Critical understanding:** When you write to a journal with `tools.appendTodoJournal()`, that content does NOT appear in your message context. It's archived to disk and hidden from context.

To bring journal content back into context, you must explicitly call `read_todo_journal({ todoIndex })`.

### When to Write Journal Entries

Use journals to archive information that:
- **Would bloat context** - Large data sets, file contents, error lists
- **Might be needed later** - Findings from discovery phase, analysis results, decisions made
- **Documents your work** - Progress tracking, what you tried, what worked/didn't work

**Example scenarios:**
- You discover 50 type errors → Journal them to keep context clean
- You analyze a complex function → Journal your findings
- You try multiple approaches → Journal what worked and why
- You make architectural decisions → Journal the reasoning

### How to Write to Journals

During code execution, use `tools.appendTodoJournal(markdown)`:

```javascript
await tools.appendTodoJournal("## Type Check Results\n\nStarting scan...");

const errors = await tools.runTypeChecker();

// Archive detailed findings
await tools.appendTodoJournal(`
## Errors Found

Total: ${errors.length}

### By File:
${Object.entries(groupBy(errors, 'file')).map(([file, errs]) =>
  `- ${file}: ${errs.length} errors`
).join('\n')}

### Details:
${errors.map(e => `- ${e.file}:${e.line} - ${e.message}`).join('\n')}
`);
```

**This writes to disk but doesn't add to your context.** Your context stays clean.

### How to Read Journals

When starting a new todo that needs findings from a previous todo:

```javascript
// You're now on todo 1: "Fix bugs"
// You need to know what bugs were found in todo 0

const findings = await read_todo_journal({ todoIndex: 0 });
// Now findings are in your context as a message
// You can see what was discovered and act on it
```

**When to read journals:**
- Starting a new todo that depends on previous findings
- Need specific details archived in an earlier phase
- Want to review decisions or approaches from before

### Journal Best Practices

1. **Archive, don't clutter** - If data is >100 lines, journal it instead of keeping in context
2. **Structure with markdown** - Use headers, lists, code blocks for readability
3. **Journal incrementally** - Write multiple small journal entries as you work, not one huge entry at the end
4. **Be selective when reading** - Only read journals you actually need; don't read "just in case"
5. **Journal your reasoning** - Future todos benefit from knowing WHY you made decisions

## Tool Reference

### write_todos(todos)
Replaces the entire todo list. First incomplete becomes current.

```javascript
write_todos([
  { description: "Analyze auth system", completed: true },
  { description: "Fix vulnerabilities", completed: false }
]);
```

### tools.appendTodoJournal(markdown)
During code execution: Appends markdown to current todo's journal. Fire-and-forget (not added to context).

```javascript
await tools.appendTodoJournal(`
## Analysis Complete

Found 3 vulnerabilities:
- SQL injection in login.ts
- Weak password hashing
- Missing rate limiting
`);
```

### read_todo_journal({ todoIndex })
Reads journal from specified todo and adds content as a message to your current context.

```javascript
const previousFindings = await read_todo_journal({ todoIndex: 0 });
// Journal content is now in your context
```

## Common Patterns

### Pattern 1: Single Todo with Journaling
```javascript
// Initial todo: "Debug the authentication issue"

// Work within single todo, journal findings
execute_code(`
  await tools.appendTodoJournal("## Investigation Started");

  const logs = await tools.readLogs();
  await tools.appendTodoJournal(\`Found \${logs.errors.length} errors\`);

  const fix = await tools.applyFix();
  await tools.appendTodoJournal(\`Applied fix: \${fix.description}\`);
`);

// Mark complete when done
write_todos([
  { description: "Debug the authentication issue", completed: true }
]);
```

### Pattern 2: Multi-Phase with Journals
```javascript
// Break complex work into phases
write_todos([
  { description: "Find all bugs", completed: false },
  { description: "Fix critical bugs", completed: false },
  { description: "Fix minor bugs", completed: false },
  { description: "Run full test suite", completed: false }
]);

// Phase 1: Find bugs (todo 0)
execute_code(`
  await tools.appendTodoJournal("## Bug Discovery");
  const bugs = await tools.findBugs();
  await tools.appendTodoJournal(\`Found \${bugs.length} bugs: \${JSON.stringify(bugs)}\`);
`);

write_todos([
  { description: "Find all bugs", completed: true },
  { description: "Fix critical bugs", completed: false },
  // ... rest
]);

// Phase 2: Fix critical (todo 1, new context)
const bugList = await read_todo_journal({ todoIndex: 0 });
// Now have bug list from phase 1

execute_code(`
  await tools.appendTodoJournal("## Fixing Critical Bugs");
  // Fix bugs using context from journal
`);
```

### Pattern 3: Cross-Todo Context Access
```javascript
// Currently on todo 3: "Write integration tests"
// Need context from discovery and implementation phases

const discoveryJournal = await read_todo_journal({ todoIndex: 0 });
const implementationJournal = await read_todo_journal({ todoIndex: 1 });

// Now have context from both previous phases
// Can write comprehensive tests based on what was discovered and implemented
```

## Initial Todo

Every request starts with an initial todo based on the user's prompt. You'll see:

```javascript
[
  { description: "Execute user request: [user's message]", completed: false }
]
```

You can:
- **Work within this todo** if the request is straightforward
- **Break it down** into multiple todos if the work is complex
- **Keep adding todos** as you discover more work to do

**Example:**

User: "Find and fix all authentication bugs"

Initial state:
```javascript
[{ description: "Execute user request: Find and fix all authentication bugs", completed: false }]
```

You could either:
- Work within the single todo (for simple cases)
- Break it down:
```javascript
write_todos([
  { description: "Find authentication bugs", completed: false },
  { description: "Fix critical authentication bugs", completed: false },
  { description: "Fix minor authentication bugs", completed: false },
  { description: "Test authentication system", completed: false }
]);
```

## Key Reminders

1. **Your context only shows current todo messages** - Previous todos are hidden
2. **Journals are fire-and-forget** - They don't appear in context unless you read them
3. **First incomplete is current** - Marking a todo complete automatically moves to next
4. **Archive liberally** - Use journals to keep context clean
5. **Read selectively** - Only retrieve journals you actually need
6. **Single or multiple todos** - Choose based on complexity, not obligation

This system lets you work on complex, multi-phase tasks while keeping context manageable and focused.
```

## Benefits of This Design

### 1. Context Isolation
- **Each todo has its own message thread** - No context pollution between todos
- **Prevents context explosion** - Context doesn't grow unbounded across all todos
- **Clean slate for each todo** - Start fresh, pull in only needed context

### 2. On-Demand Context Retrieval
- **Fire-and-forget journaling** - Archive findings without bloating current context
- **Explicit retrieval** - Only bring back context when needed
- **Selective loading** - LLM decides what historical context is relevant

### 3. Natural LLM Workflow
- **Gather data phase** → Writes journal via code execution
- **Process data phase** → Reads journal when needed
- **Matches sequential task execution** - One todo at a time with clean boundaries

### 4. Human-Readable Debugging
- Open `.todos/todo-0-journal.md` and see exactly what the LLM did
- Markdown format is immediately understandable
- No special tooling required to inspect

### 5. Multi-Session Memory & History
- Journals persist across sessions
- LLM can resume work hours/days later by reading journal
- Full work history preserved per-todo
- **Complete todo history maintained** - Completed todos remain in list, new user requests append
- Users can see full progression of work from start to finish

### 6. Scalable to Many Todos
- Adding more todos doesn't increase context linearly
- Only current todo's messages in context
- Historical todos archived via journals

## Advanced Considerations

### Journal Size Management

Journals can grow large. Strategies to consider:

**Option A: Size limits**
```javascript
if (getCurrentJournalSize(todoIndex) > 50_000) {
  throw new Error("Journal too large. Consider summarizing.");
}
```

**Option B: Auto-summarization tool**
```javascript
// Additional custom tool
tools.summarizeTodoJournal = async () => {
  const journal = await readCurrentJournal();
  const summary = await tools.summarize(journal);
  await replaceJournal(summary);
};
```

**Recommendation for MVP**: Start without limits. Monitor real usage to see if it becomes an issue.

### Cross-Todo Context Access

When working on a todo, you can read journals from ANY previous todo:

```javascript
// Currently on todo 2: "Run tests"
const findingsJournal = await read_todo_journal({ todoIndex: 0 });
const fixesJournal = await read_todo_journal({ todoIndex: 1 });

// Now have context from both previous todos
await tools.runTests();
```

This is powerful but can bloat context if overused. LLM should be selective about what to retrieve.

### Lifecycle Management

When are journals deleted?

**Options:**
- **On todo removal**: Delete journal when todo removed from list → Loses history
- **On user action**: Manual cleanup command → User control
- **Never**: Keep for entire session → Full audit trail

**Recommendation**: Keep until session ends. Disk space is cheap, context is valuable. Even if a todo is removed from the list, its journal may be useful later.

### Re-reading Journal in Same Todo

If LLM reads a journal with `read_todo_journal`, that content becomes a message in the current todo's message array. It persists across turns for that todo.

```
Turn 1: LLM reads todo 0's journal → Added to todo 1's messages
Turn 2: Still working on todo 1 → Journal content still in context
Turn 3: Move to todo 2 → Journal content no longer in context (was in todo 1's messages)
```

If working on todo 2 and need the same journal, must read it again (or read todo 1's messages via its journal if todo 1 journaled the findings).

### Todo Message Persistence

Todo message arrays persist for the entire session:

```typescript
// After working on todos 0, 1, 2:
todoMessages = {
  0: [10 messages],
  1: [25 messages],
  2: [5 messages]  // Current
}

// If LLM goes back to todo 0 (marks it incomplete again):
currentTodoIndex = 0
// Context includes all 10 messages from when it was worked on before
```

### User Messages Across Todo Changes

#### During Active Todos

When user sends a message while working on todos:
- Added to current todo's message array
- If current todo changes (via write_todos), next user message goes to new current todo

```
User: "Find errors" → Added to todo 0
LLM: [works on todo 0]
LLM: write_todos([completed: true, ...]) → Current changes to todo 1
User: "Fix them" → Added to todo 1
```

#### After All Todos Complete

When all todos are complete and user sends a new message:
- System appends a new todo: `"Execute user request: [message]"`
- New todo becomes current (first incomplete)
- User message added to new todo's message array
- Full todo history preserved

```typescript
// Before user message
sessionState.todos = [
  { description: "Find bugs", completed: true },
  { description: "Fix bugs", completed: true }
];
sessionState.currentTodoIndex = -1; // No current todo

// User: "Now add tests"
// System automatically:
sessionState.todos.push({
  description: "Execute user request: Now add tests",
  completed: false
});
sessionState.currentTodoIndex = 2; // New todo index
sessionState.todoMessages[2] = [{ role: "user", content: "Now add tests" }];

// Send todos_updated SSE message
queueMessage({
  type: "todos_updated",
  todos: sessionState.todos,
  currentTodoIndex: 2
});

// After
sessionState.todos = [
  { description: "Find bugs", completed: true },
  { description: "Fix bugs", completed: true },
  { description: "Execute user request: Now add tests", completed: false } // ← New
];
```

**This preserves full session history** - all completed todos remain visible in the list.

## Implementation Checklist

### Core System
- [ ] Create `SessionState` interface and initialization
- [ ] Implement automatic initial todo creation on first user message
- [ ] Implement automatic todo append when all todos complete and user sends new message
- [ ] Implement `createWriteTodosTool(sessionState, queueMessage)` native tool factory
- [ ] Implement todo message scoping - separate arrays per todo in SessionState
- [ ] Implement current todo determination (first incomplete)
- [ ] Implement message tagging system (track which todo generated which messages)
- [ ] Implement context building that only includes current todo's messages
- [ ] Ensure initial write_todos call is always included in context
- [ ] Send `todos_updated` SSE message when todos change (including automatic appends)

### Journaling
- [ ] Implement `createAppendTodoJournalTool(sessionState, workspacePath)` custom tool factory
- [ ] Implement `createReadTodoJournalTool(workspacePath)` native tool factory
- [ ] Ensure read journal adds content to current todo's message array
- [ ] Create `.todos/` directory on agent initialization
- [ ] Handle edge cases (missing journal file, corrupted markdown, invalid todoIndex)

### System Prompt
- [ ] Update system prompt with comprehensive todo and journaling guidance
- [ ] Include examples of single vs multiple todo patterns
- [ ] Document message scoping behavior
- [ ] Explain fire-and-forget journaling concept
- [ ] Provide tool reference and common patterns

### UI/UX
- [ ] Define `todos_updated` SSE message type
- [ ] Handle `todos_updated` messages in UI to display todo list
- [ ] Highlight current todo in UI
- [ ] Show completed todos with visual indicator (strikethrough, checkmark, etc.)
- [ ] Add SSE message type for journal updates (optional)
- [ ] Add journal existence indicators (check filesystem for .md files, optional)
- [ ] Add cleanup on session end (optional)

## Example End-to-End Flow

### User Request
"Analyze the authentication system and identify security vulnerabilities"

### Turn 1: Create Todos & Analyze

```javascript
// LLM creates todos
write_todos([
  { description: "Analyze auth system for vulnerabilities", completed: false },
  { description: "Fix critical vulnerabilities", completed: false }
]);
// System: currentTodoIndex = 0

// LLM generates and executes code
execute_code(`
  await tools.appendTodoJournal("## Authentication Analysis\n\nStarting security audit...");

  const authFiles = await tools.findFiles("**/auth*.ts");
  await tools.appendTodoJournal(\`Found \${authFiles.length} auth-related files\`);

  const vulnScan = await tools.scanForVulnerabilities(authFiles);

  await tools.appendTodoJournal(\`
## Vulnerability Scan Results

Found \${vulnScan.critical} critical, \${vulnScan.medium} medium, \${vulnScan.low} low severity issues.

### Critical Issues:
\${vulnScan.details.filter(v => v.severity === 'critical').map(v =>
  \`- **\${v.type}** in \\\`\${v.file}:\${v.line}\\\`: \${v.description}\`
).join('\\n')}

### Recommendations:
1. Fix SQL injection in auth/login.ts:45
2. Update password hashing to bcrypt
3. Add rate limiting to login endpoint
  \`);
`);

// LLM marks analysis complete
write_todos([
  { description: "Analyze auth system for vulnerabilities", completed: true },
  { description: "Fix critical vulnerabilities", completed: false }
]);
// System: currentTodoIndex = 1 (changes to first incomplete)
```

**State after Turn 1:**
```typescript
todos = [
  { description: "Analyze auth system for vulnerabilities", completed: true },
  { description: "Fix critical vulnerabilities", completed: false }
]

todoMessages = {
  0: [
    { role: "user", content: "Analyze the authentication system..." },
    { role: "assistant", content: [write_todos call] },
    { role: "assistant", content: [execute_code call] },
    { role: "tool", content: "Code execution result..." },
    { role: "assistant", content: [write_todos call marking complete] }
  ],
  1: []
}

journals = {
  0: ".todos/todo-0-journal.md" // Contains vulnerability findings
}

currentTodoIndex = 1
```

### Turn 2: Fix Vulnerabilities

```javascript
// Context sent to LLM:
// - System message
// - Last write_todos: [{ completed: true }, { completed: false }]
// - Todo 1 messages: [] (empty)

// LLM realizes it needs findings from analysis
const analysis = await read_todo_journal({ todoIndex: 0 });
// System: Adds journal content as message to todo 1's array

// LLM now has vulnerability details in context

// LLM generates fix code
execute_code(`
  await tools.appendTodoJournal("## Fixing Critical Issues\n\nStarting with SQL injection...");

  const sqlFix = await tools.applyFix({
    file: "auth/login.ts",
    line: 45,
    fix: "parameterized_query"
  });

  await tools.appendTodoJournal(\`
### SQL Injection Fix
\${sqlFix.success ? '✓' : '✗'} Applied parameterized query to login.ts:45
\${sqlFix.diff}
  \`);

  const hashFix = await tools.updatePasswordHashing("bcrypt");

  await tools.appendTodoJournal(\`
### Password Hashing Update
\${hashFix.success ? '✓' : '✗'} Updated to bcrypt in auth/password.ts
  \`);

  // Continue with other fixes...
`);

// LLM marks fixes complete
write_todos([
  { description: "Analyze auth system for vulnerabilities", completed: true },
  { description: "Fix critical vulnerabilities", completed: true },
  { description: "Run security tests", completed: false }  // Added new todo
]);
// System: currentTodoIndex = 2
```

**State after Turn 2:**
```typescript
todos = [
  { description: "Analyze auth system for vulnerabilities", completed: true },
  { description: "Fix critical vulnerabilities", completed: true },
  { description: "Run security tests", completed: false }
]

todoMessages = {
  0: [...], // Hidden, not in context
  1: [
    { role: "assistant", content: [read_todo_journal call] },
    { role: "tool", content: "Journal from todo 0..." },
    { role: "assistant", content: [execute_code call] },
    { role: "tool", content: "Code execution result..." },
    { role: "assistant", content: [write_todos call] }
  ],
  2: []
}

journals = {
  0: ".todos/todo-0-journal.md", // Vulnerability findings
  1: ".todos/todo-1-journal.md"  // Fix details with diffs
}

currentTodoIndex = 2
```

### Turn 3: Run Tests

```javascript
// Context sent to LLM:
// - System message
// - Last write_todos: [completed, completed, incomplete]
// - Todo 2 messages: [] (empty)

// LLM could read previous journals if needed
const analysisJournal = await read_todo_journal({ todoIndex: 0 });
const fixesJournal = await read_todo_journal({ todoIndex: 1 });

// Now has full context of what was found and fixed

execute_code(`
  await tools.appendTodoJournal("## Running Security Tests\n\nExecuting test suite...");

  const testResults = await tools.runSecurityTests();

  await tools.appendTodoJournal(\`
## Test Results
\${testResults.passed}/${testResults.total} tests passed

${testResults.failed > 0 ? \`
### Failed Tests:
\${testResults.failures.map(f => \`- \${f.name}: \${f.reason}\`).join('\\n')}
\` : '✓ All tests passed!'}
  \`);
`);
```

### Result

Three journal files:
- `.todos/todo-0-journal.md` - Analysis findings with vulnerabilities
- `.todos/todo-1-journal.md` - Fix details with diffs and results
- `.todos/todo-2-journal.md` - Test results and any follow-up items

Each is human-readable, debuggable, and provides full context for that phase of work. Message context stays manageable by only including current todo's messages.

### Turn 4: User Adds New Request After Completion

```javascript
// All todos now completed
sessionState.todos = [
  { description: "Analyze auth system for vulnerabilities", completed: true },
  { description: "Fix critical vulnerabilities", completed: true },
  { description: "Run security tests", completed: true }
];
sessionState.currentTodoIndex = -1; // No current todo

// User sends new message
User: "Now add rate limiting to the API"

// System automatically appends new todo
sessionState.todos.push({
  description: "Execute user request: Now add rate limiting to the API",
  completed: false
});
sessionState.currentTodoIndex = 3;
sessionState.todoMessages[3] = [{ role: "user", content: "Now add rate limiting to the API" }];

// Send todos_updated SSE
queueMessage({
  type: "todos_updated",
  todos: sessionState.todos,
  currentTodoIndex: 3
});

// Final todo list shows complete history:
[
  { description: "Analyze auth system for vulnerabilities", completed: true },
  { description: "Fix critical vulnerabilities", completed: true },
  { description: "Run security tests", completed: true },
  { description: "Execute user request: Now add rate limiting to the API", completed: false }
]

// LLM can break down or work within this todo as needed
```

**Result**: Full session history visible - user can see entire progression from initial security audit through rate limiting addition.

---

## Conclusion

The journaling system with message scoping provides a **scalable, context-efficient way** for LLMs to manage multi-step workflows. By:

1. **Always operating in "todos world"** - Every request starts with an initial todo, no pre-todo state
2. **Isolating messages per todo** - Prevents context explosion across multiple tasks
3. **Fire-and-forget journaling** - Archives findings outside message stream
4. **On-demand retrieval** - Brings archived context back only when needed
5. **Automatic current todo tracking** - First incomplete todo is always current

This architecture integrates cleanly with the existing Together Agent SDK, leveraging:
- Native tools for state management (write_todos, read_todo_journal)
- Custom tools for in-execution operations (appendTodoJournal)
- Pre-written JavaScript execution model for adaptive journaling
- Message-based communication pattern
- Automatic initialization of todo system on first user message

The result is a system where:
- **Every interaction happens within a todo context** - Simplifies mental model
- **Each todo has a clean, isolated conversation thread** - No cross-contamination
- **Historical context is available on-demand via journals** - Pull only what's needed
- **Context stays bounded regardless of task complexity** - Scales to many todos
- **Full debugging visibility** - Human-readable markdown journals document all work
- **Complete session history preserved** - All todos remain in list, showing full progression of work
- **Seamless continuation** - New user requests automatically append to todo list

The LLM can choose to work within a single todo for simple tasks or break down complex work into multiple phases, with each phase having its own isolated context and journal. This flexibility combined with automatic context management and history preservation makes it suitable for both simple queries and complex, multi-phase projects spanning multiple user requests.
