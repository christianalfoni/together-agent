# Journal Entry System - Implementation Specification

## Overview

This document outlines a journaling system for the Together Agent SDK that provides automatic context management through progressive compression. Unlike task-based systems that proactively isolate context, this system allows continuous work with natural documentation points and reactively compresses old context when needed.

## Core Concept

**The agent maintains a single continuous conversation with journal entries that document work.** Instead of forcing discrete task boundaries upfront, the agent works naturally and creates journal entries at meaningful points. As the conversation grows, older journal entries are compressed to maintain manageable context size.

### Mental Model

```
Continuous Message Stream:
├─ User: "Find and fix authentication bugs"
├─ Assistant: add_journal_entry("Analyzing authentication system")
├─ Assistant: execute_code(...)
├─ Tool: results
├─ Assistant: add_journal_entry("Fixing critical SQL injection")
├─ Assistant: execute_code(...)
├─ Tool: results
├─ ... (messages continue)
└─ Eventually: Old entries compressed, can be read on-demand

Journal Files:
├─ .journal/entry-0.md (Analyzing authentication system)
├─ .journal/entry-1.md (Fixing critical SQL injection)
└─ .journal/entry-2.md (Testing security fixes)

Compression Happens Automatically:
- When context size exceeds threshold (configurable, default: 50000 tokens)
- Replaces old journal entry messages with single compressed message
- Keeps active entry + recent K entries uncompressed (configurable, default: 1)
- Compressed entries can be read via read_journal_entries()
```

**Key insight**: Context management is lazy and reactive, not proactive. Let the conversation flow naturally, compress when needed.

## Architecture

### Three-Part System

1. **Native Tool: `add_journal_entry({ title })`** - Marks start of new journal entry
   - Takes title string describing what's being worked on
   - Creates new journal entry in session state
   - Increments journal entry counter
   - Tags subsequent messages to this entry
   - Triggers compression check
   - Returns journal entry index

2. **Custom Tool: `tools.addJournalEntry(title, markdown)`** - Creates new journal entries during execution
   - Available during code execution scope
   - Creates `.journal/entry-{index}.md` with the given title and content
   - Fire-and-forget: Does NOT add to message context
   - Used to archive detailed findings as separate entries

3. **Native Tool: `read_journal_entries({ entryIndices })`** - Reads journals back
   - Takes array of entry indices to read
   - Retrieves full markdown content from specified entries
   - Adds journal content as messages to conversation
   - Brings archived context back when needed
   - Sends SSE message when executed

### Automatic Compression System

The system automatically compresses tool results to manage context:

**Compression Trigger**: When context size exceeds token threshold (default: 50000 tokens)
**What Gets Compressed**: All tool result messages (role: "tool")
**What's Preserved**: All user messages and assistant text messages
**Compression Format**: Tool messages replaced with journal entry listings attached to their corresponding user/assistant messages

## Message Context Structure

### Session State Schema

```typescript
interface JournalEntry {
  index: number;           // 0, 1, 2, ...
  title: string;           // "Analyzing authentication system"
  compressed: boolean;     // Has this entry been compressed?
  filePath: string;        // ".journal/entry-0.md"
}

interface SessionState {
  messages: CoreMessage[];                    // All conversation messages
  journalEntries: JournalEntry[];            // Metadata for all entries
  messageToJournals: Map<any, number[]>;     // Maps message object to journal entry indices
  lastUserOrAssistantMessage: any | null;    // Last user/assistant message for journal attachment
  lastPromptTokens: number;                  // Token count from last API response
}

// Configuration options
interface JournalConfig {
  contextSizeThreshold: number;  // Compress when context exceeds N tokens (default: 50000)
}
```

### Journal Attachment

Journals are attached to the last user or assistant message when created:

```typescript
// When tools.addJournalEntry() is called during code execution
const lastMessage = sessionState.lastUserOrAssistantMessage;
const journalIndices = sessionState.messageToJournals.get(lastMessage) || [];
sessionState.messageToJournals.set(lastMessage, [...journalIndices, newJournalIndex]);

// This allows us to know which journals belong to which message for compression
```

### Context Building

Every LLM request includes:

```typescript
function buildContext(sessionState: SessionState): CoreMessage[] {
  // Simply return all messages - compression already happened
  return [
    { role: "system", content: systemPrompt },
    ...sessionState.messages
  ];
}
```

Compression happens **before** building context, so the message array is always ready to send.

## Compression Algorithm

### Token Tracking

After each API call, update the session state with token count:

```typescript
// After receiving API response
const response = await llmAPI.chat(messages);
sessionState.lastPromptTokens = response.usage.prompt_tokens;

// Check if compression needed
if (shouldCompress(sessionState, config)) {
  performCompression(sessionState, config, queueMessage);
}
```

### When Compression Triggers

```typescript
function shouldCompress(sessionState: SessionState, config: JournalConfig): boolean {
  // Compress when context size exceeds threshold
  return sessionState.lastPromptTokens > config.contextSizeThreshold;
}
```

### What Gets Compressed

```typescript
function performCompression(
  sessionState: SessionState,
  config: JournalConfig,
  queueMessage: (msg: AgentMessage) => void
): void {
  const newMessages: any[] = [];
  const compressedJournalIndices: number[] = [];

  // Iterate through messages, keeping user/assistant and removing tool messages
  for (const message of sessionState.messages) {
    if (message.role === "user" || message.role === "assistant") {
      // Keep user and assistant messages
      newMessages.push(message);

      // Check if this message has journals attached
      const journalIndices = sessionState.messageToJournals.get(message);
      if (journalIndices && journalIndices.length > 0) {
        // Get uncompressed journals for this message
        const uncompressedJournals = journalIndices
          .map((idx) => sessionState.journalEntries[idx])
          .filter((entry) => entry && !entry.compressed);

        if (uncompressedJournals.length > 0) {
          // Create journal listing message
          const journalListingContent =
            "Journal entries from this work:\n" +
            uncompressedJournals
              .map((e) => `- Entry ${e.index}: ${e.title}`)
              .join("\n") +
            "\n\nUse read_journal_entries({ entryIndices: [" +
            uncompressedJournals.map((e) => e.index).join(", ") +
            "] }) to retrieve details.";

          const journalMessage: any = {
            role: "assistant",
            content: journalListingContent,
          };

          newMessages.push(journalMessage);

          // Mark these journals as compressed
          uncompressedJournals.forEach((entry) => {
            entry.compressed = true;
            compressedJournalIndices.push(entry.index);
          });
        }
      }
    }
    // Skip tool messages entirely
  }

  // Replace messages array
  sessionState.messages = newMessages;
}
```

### Compression Example

**Before compression** (context reaches 55000 tokens):
```
Messages: [
  { role: "system", content: "..." },
  { role: "user", content: "Find and fix bugs" },
  { role: "assistant", content: "I'll analyze the codebase..." },  // journals 0, 1 attached
  { role: "tool", content: "Found 15 bugs [huge output]" },
  { role: "assistant", content: "I'll fix the critical ones..." },  // journal 2 attached
  { role: "tool", content: "Fixed 5 bugs [huge output]" },
  { role: "user", content: "Run the tests" },
  { role: "assistant", content: "Running tests..." },  // journal 3 attached
  { role: "tool", content: "Tests passing [huge output]" },
  // ← Compression triggers here (context: 55000 tokens > 50000 threshold)
]

messageToJournals Map:
  assistant[0] → [0, 1]  // "I'll analyze the codebase..."
  assistant[1] → [2]     // "I'll fix the critical ones..."
  assistant[2] → [3]     // "Running tests..."
```

**After compression** (tool messages removed, journal listings inserted):
```
Messages: [
  { role: "system", content: "..." },
  { role: "user", content: "Find and fix bugs" },
  { role: "assistant", content: "I'll analyze the codebase..." },
  { role: "assistant", content: "Journal entries from this work:\n- Entry 0: Bug Analysis\n- Entry 1: Vulnerability Scan\n\nUse read_journal_entries({ entryIndices: [0, 1] }) to retrieve details." },
  { role: "assistant", content: "I'll fix the critical ones..." },
  { role: "assistant", content: "Journal entries from this work:\n- Entry 2: Critical Fixes Applied\n\nUse read_journal_entries({ entryIndices: [2] }) to retrieve details." },
  { role: "user", content: "Run the tests" },
  { role: "assistant", content: "Running tests..." },
  { role: "assistant", content: "Journal entries from this work:\n- Entry 3: Test Results\n\nUse read_journal_entries({ entryIndices: [3] }) to retrieve details." },
]

Journal Entries State: [
  { index: 0, title: "Bug Analysis", compressed: true, ... },
  { index: 1, title: "Vulnerability Scan", compressed: true, ... },
  { index: 2, title: "Critical Fixes Applied", compressed: true, ... },
  { index: 3, title: "Test Results", compressed: true, ... }
]
```

**Key differences:**
- All tool messages removed (they contain the bulk of the context)
- User and assistant text messages preserved (the narrative)
- Journal listings inserted after their associated messages
- Context reduced from 55000 → ~10000 tokens while preserving the conversation flow

**Context saved**: Replaced ~12 messages with 1 compressed message, maintaining access to all details via `read_journal_entries()`.

## Data Flow

### Turn 1: Starting Work

```
User: "Find and fix all authentication bugs"

LLM → add_journal_entry({ title: "Analyzing authentication system" })
  System: Creates entry 0, sets currentEntryIndex = 0
  System: Tags subsequent messages to entry 0

LLM → execute_code(`
  const vulns = await tools.scanVulnerabilities();

  await tools.addJournalEntry(
    "Security Audit Results",
    \`
## Scan Summary

Found \${vulns.length} vulnerabilities across authentication files.

### Critical Issues:
\${vulns.filter(v => v.severity === 'critical').map(v =>
  \`- \${v.type} in \${v.file}:\${v.line}\`
).join('\\n')}
    \`
  );
`)
  System: Writes to .journal/entry-0.md (not added to messages)
  System: All messages tagged to entry 0
```

**State after Turn 1:**
```typescript
messages = [
  { role: "system", content: "..." },
  { role: "user", content: "Find and fix all authentication bugs" },
  { role: "assistant", content: [add_journal_entry call] },
  { role: "tool", content: "Created journal entry 0: 'Analyzing authentication system'" },
  { role: "assistant", content: [execute_code call] },
  { role: "tool", content: "Code execution result..." }
]

journalEntries = [
  { index: 0, title: "Analyzing authentication system", compressed: false, filePath: ".journal/entry-0.md" }
]

currentEntryIndex = 0
```

### Turn 2: Continuing Work, New Entry

```
LLM → add_journal_entry({ title: "Fixing SQL injection vulnerability" })
  System: Creates entry 1, sets currentEntryIndex = 1
  System: Tags subsequent messages to entry 1

LLM → execute_code(`
  const result = await tools.fixSQLInjection("auth/login.ts", 45);

  await tools.addJournalEntry(
    "SQL Injection Fix",
    \`
## Fix Applied

Applied parameterized queries to auth/login.ts:45

Result: \${result.success ? '✓' : '✗'}
    \`
  );
`)
  System: Writes to .journal/entry-1.md
  System: All messages tagged to entry 1
```

### Turn 3-5: More Entries Created

```
// Turn 3
add_journal_entry({ title: "Fixing weak password hashing" }) → Entry 2

// Turn 4
add_journal_entry({ title: "Adding rate limiting" }) → Entry 3

// Turn 5
add_journal_entry({ title: "Running security tests" }) → Entry 4 (becomes active)

System: Context size reaches 52000 tokens (exceeds 50000 threshold)
System: Performs compression (keeps active entry 4 + recent completed entry 3, compresses 0-2)
System: Sends journal_entries_compressed SSE message
```

**State after Turn 5 (post-compression):**
```typescript
messages = [
  { role: "system", content: "..." },
  { role: "user", content: "Find and fix all authentication bugs" },
  { role: "assistant", content: "Previous work has been documented in journal entries. You can read entries in detail if needed:\n\n- Entry 0: \"Analyzing authentication system\"\n- Entry 1: \"Fixing SQL injection vulnerability\"\n- Entry 2: \"Fixing weak password hashing\"\n\nUse read_journal_entries({ entryIndices: [0, 1, ...] }) to retrieve specific entries." },
  { role: "assistant", content: [add_journal_entry("Adding rate limiting")] },  // Entry 3 - kept
  { role: "tool", content: "Created journal entry 3..." },
  // ... entry 3 messages ...
  { role: "assistant", content: [add_journal_entry("Running security tests")] },  // Entry 4 - active
  { role: "tool", content: "Created journal entry 4..." },
  // ... messages for entry 4 continue
]

journalEntries = [
  { index: 0, title: "Analyzing authentication system", compressed: true, ... },
  { index: 1, title: "Fixing SQL injection vulnerability", compressed: true, ... },
  { index: 2, title: "Fixing weak password hashing", compressed: true, ... },
  { index: 3, title: "Adding rate limiting", compressed: false, ... },  // Recent completed
  { index: 4, title: "Running security tests", compressed: false, ... }  // Active
]

currentEntryIndex = 4
```

### Turn 6: Reading Compressed Entries

```
LLM: I need to check what vulnerabilities were originally found and what SQL injection fix was applied

LLM → read_journal_entries({ entryIndices: [0, 1] })
  System: Reads .journal/entry-0.md and .journal/entry-1.md
  System: Adds content as tool messages to conversation
  System: Sends SSE message: journal_entries_read

LLM: Now has full context from entries 0 and 1, can reference specific vulnerabilities and fixes
```

**Messages after read:**
```typescript
messages = [
  { role: "system", content: "..." },
  { role: "user", content: "Find and fix all authentication bugs" },
  { role: "assistant", content: "Previous work documented in entries..." },
  { role: "assistant", content: [add_journal_entry("Adding rate limiting")] },
  { role: "tool", content: "Created journal entry 3..." },
  // ... entry 3 messages ...
  { role: "assistant", content: [add_journal_entry("Running security tests")] },
  { role: "tool", content: "Created journal entry 4..." },
  // ... entry 4 messages ...
  { role: "assistant", content: [read_journal_entries({ entryIndices: [0, 1] })] },
  { role: "tool", content: "# Entry 0: Analyzing authentication system\n\n## Security Audit\n\n...\n\n---\n\n# Entry 1: Fixing SQL injection vulnerability\n\n..." }  // Full journal content from both entries
]
```

## Configuration Options

The system accepts configuration options for tuning compression behavior:

```typescript
interface JournalConfig {
  // Trigger compression when context exceeds N tokens
  // Default: 50000
  // Lower = more aggressive compression, higher = allow larger context before compressing
  contextSizeThreshold: number;

  // Keep most recent K completed entries uncompressed after compression
  // Default: 1
  // Active entry is ALWAYS kept uncompressed
  // 0 = compress all completed entries, higher = keep more recent work in full
  keepRecentCount: number;
}

// API usage
app.post("/prompt", async (req, res) => {
  const { prompt, journalConfig } = req.body;

  const config = {
    contextSizeThreshold: journalConfig?.contextSizeThreshold ?? 50000,
    keepRecentCount: journalConfig?.keepRecentCount ?? 1
  };

  // Use config in agent execution
});
```

**Tuning guidance**:
- **contextSizeThreshold = 30000**: Aggressive, good for very long sessions
- **contextSizeThreshold = 50000**: Balanced default (recommended)
- **contextSizeThreshold = 100000**: Conservative, allows larger context before compressing
- **keepRecentCount = 0**: Compress all completed entries, keep only active entry
- **keepRecentCount = 1**: Keep active + 1 recent completed entry (recommended default)
- **keepRecentCount = 2-3**: Keep more recent context (useful for related sequential work)

## Implementation Details

### File Storage

```
/workspace/.journal/
├── entry-0.md      # First journal entry
├── entry-1.md      # Second journal entry
├── entry-2.md      # Third journal entry
└── ...
```

### Native Tool: add_journal_entry

```typescript
const createAddJournalEntryTool = (
  sessionState: SessionState,
  config: JournalConfig,
  queueMessage: (msg: EventMessage) => void
) => ({
  name: "add_journal_entry",
  description: "Create a new journal entry to document a phase of work. Use this when starting a new meaningful phase or when the focus of work shifts.",
  inputSchema: z.object({
    title: z.string().describe("Short title describing what you're about to work on")
  }),
  execute: async ({ title }: { title: string }) => {
    const entryIndex = sessionState.journalEntries.length;
    const filePath = `.journal/entry-${entryIndex}.md`;

    // Create journal entry metadata
    const entry: JournalEntry = {
      index: entryIndex,
      title,
      compressed: false,
      filePath
    };

    sessionState.journalEntries.push(entry);
    sessionState.currentEntryIndex = entryIndex;

    // Create journal file
    fs.mkdirSync(path.join(workspacePath, ".journal"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, filePath),
      `# ${title}\n\n`
    );

    // Send SSE message
    queueMessage({
      type: "journal_entry_created",
      entryIndex,
      title
    });

    // Check if compression needed
    if (shouldCompress(sessionState, config)) {
      performCompression(sessionState, config, queueMessage);
    }

    return `Created journal entry ${entryIndex}: "${title}"`;
  }
});
```

### Custom Tool: addJournalEntry

```typescript
const createAddJournalEntryTool = (
  sessionState: SessionState,
  config: JournalConfig,
  workspacePath: string,
  queueMessage: (msg: EventMessage) => void
) => {
  return async (title: string, markdown: string) => {
    // Create new journal entry
    const entryIndex = sessionState.journalEntries.length;
    const filePath = `.journal/entry-${entryIndex}.md`;

    const entry: JournalEntry = {
      index: entryIndex,
      title,
      compressed: false,
      filePath,
    };

    sessionState.journalEntries.push(entry);
    sessionState.currentEntryIndex = entryIndex;

    // Create journal file with title and content
    const journalDir = path.join(workspacePath, ".journal");
    fs.mkdirSync(journalDir, { recursive: true });

    const fullContent = `# ${title}\n\n${markdown.trim()}\n`;
    fs.writeFileSync(path.join(workspacePath, filePath), fullContent);

    // Send SSE message
    queueMessage({
      type: "journal_entry_created",
      entryIndex,
      title,
    });

    // Check if compression needed
    if (shouldCompress(sessionState, config)) {
      performCompression(sessionState, config, queueMessage);
    }
  };
};

// Expose to code execution
const tools = {
  addJournalEntry: createAddJournalEntryTool(sessionState, config, workspacePath, queueMessage),
  // ... other tools
};
```

### Native Tool: read_journal_entries

```typescript
const createReadJournalEntriesTool = (
  workspacePath: string,
  queueMessage: (msg: EventMessage) => void
) => ({
  name: "read_journal_entries",
  description: "Read the full contents of one or more journal entries to retrieve detailed context from previous work. This is a native tool that you call directly (not through code execution).",
  inputSchema: z.object({
    entryIndices: z.array(z.number().min(0)).describe("Array of journal entry indices to read")
  }),
  execute: async ({ entryIndices }: { entryIndices: number[] }) => {
    const contents: string[] = [];

    for (const entryIndex of entryIndices) {
      const journalPath = path.join(workspacePath, `.journal/entry-${entryIndex}.md`);

      if (!fs.existsSync(journalPath)) {
        contents.push(`# Entry ${entryIndex}: Not found\n\nThis journal entry does not exist or has no content.`);
      } else {
        const markdown = fs.readFileSync(journalPath, 'utf-8');
        contents.push(`# Entry ${entryIndex}\n\n${markdown}`);
      }
    }

    // Send SSE message
    queueMessage({
      type: "journal_entries_read",
      entryIndices
    });

    // Combine all entries with separators
    return contents.join('\n\n---\n\n');
  }
});
```

### Compression Implementation

```typescript
function shouldCompress(sessionState: SessionState, config: JournalConfig): boolean {
  // Compress when context size exceeds threshold
  return sessionState.lastPromptTokens > config.contextSizeThreshold;
}

function performCompression(
  sessionState: SessionState,
  config: JournalConfig,
  queueMessage: (msg: EventMessage) => void
): void {
  // Get uncompressed entries
  const uncompressedEntries = sessionState.journalEntries.filter(e => !e.compressed);

  // Separate active entry from completed entries
  // Active entry is NEVER compressed
  const completedEntries = uncompressedEntries.filter(
    e => e.index !== sessionState.currentEntryIndex
  );

  // Compress all completed entries except most recent K
  const entriesToCompress = completedEntries.slice(0, -config.keepRecentCount);

  if (entriesToCompress.length === 0) return;

  // Find message indices belonging to these entries
  const messageIndicesToRemove = new Set<number>();
  sessionState.messages.forEach((msg, index) => {
    const entryIndex = sessionState.messageToEntryMap.get(index);
    if (entryIndex !== undefined && entriesToCompress.some(e => e.index === entryIndex)) {
      messageIndicesToRemove.add(index);
    }
  });

  if (messageIndicesToRemove.size === 0) return;

  // Create compressed message
  const compressedContent =
    "Previous work has been documented in journal entries. " +
    "You can read entries in detail if needed:\n\n" +
    entriesToCompress.map(e =>
      `- Entry ${e.index}: "${e.title}"`
    ).join('\n') +
    '\n\nUse read_journal_entries({ entryIndices: [0, 1, ...] }) to retrieve specific entries.';

  const compressedMessage: CoreMessage = {
    role: "assistant",
    content: compressedContent
  };

  // Replace old messages with compressed message
  const sortedIndices = Array.from(messageIndicesToRemove).sort((a, b) => a - b);
  const firstIndex = sortedIndices[0];
  const lastIndex = sortedIndices[sortedIndices.length - 1];
  const removeCount = lastIndex - firstIndex + 1;

  sessionState.messages.splice(firstIndex, removeCount, compressedMessage);

  // Mark entries as compressed
  entriesToCompress.forEach(entry => {
    entry.compressed = true;
  });

  // Send SSE message about compression
  queueMessage({
    type: "journal_entries_compressed",
    compressedEntries: entriesToCompress.map(e => ({
      index: e.index,
      title: e.title
    }))
  });

  // Rebuild message-to-entry map (indices shifted after splice)
  rebuildMessageToEntryMap(sessionState);
}

function rebuildMessageToEntryMap(sessionState: SessionState): void {
  // Clear map
  sessionState.messageToEntryMap.clear();

  // Rebuild by scanning messages
  let currentEntry = -1;
  sessionState.messages.forEach((msg, index) => {
    // Check if this message is an add_journal_entry tool call
    if (msg.role === "assistant" && typeof msg.content !== "string") {
      const toolCall = msg.content.find((c: any) => c.type === "tool_use" && c.name === "add_journal_entry");
      if (toolCall) {
        // Extract entry index from next tool result message
        const nextMsg = sessionState.messages[index + 1];
        if (nextMsg?.role === "tool") {
          const match = nextMsg.content.match(/Created journal entry (\d+):/);
          if (match) {
            currentEntry = parseInt(match[1]);
          }
        }
      }
    }

    if (currentEntry >= 0) {
      sessionState.messageToEntryMap.set(index, currentEntry);
    }
  });
}
```

### SSE Message Types

```typescript
type EventMessage =
  | { type: "journal_entry_created"; entryIndex: number; title: string }
  | { type: "journal_entries_read"; entryIndices: number[] }
  | { type: "journal_entries_compressed"; compressedEntries: Array<{ index: number; title: string }> }
  | ... // other existing message types

// Sent when add_journal_entry() is called
queueMessage({
  type: "journal_entry_created",
  entryIndex: 2,
  title: "Fixing SQL injection vulnerability"
});

// Sent when read_journal_entries() is called
queueMessage({
  type: "journal_entries_read",
  entryIndices: [0, 1, 3]
});

// Sent when compression occurs
queueMessage({
  type: "journal_entries_compressed",
  compressedEntries: [
    { index: 0, title: "Analyzing authentication system" },
    { index: 1, title: "Fixing SQL injection vulnerability" },
    { index: 2, title: "Fixing weak password hashing" }
  ]
});
```

### Initial Setup

```typescript
// Initialize session state
const sessionState: SessionState = {
  messages: [],
  journalEntries: [],
  currentEntryIndex: -1,
  messageToEntryMap: new Map(),
  lastPromptTokens: 0
};

const config: JournalConfig = {
  contextSizeThreshold: req.body.journalConfig?.contextSizeThreshold ?? 50000,
  keepRecentCount: req.body.journalConfig?.keepRecentCount ?? 1
};

// Create tools
const addJournalEntryTool = createAddJournalEntryTool(sessionState, config, queueMessage);
const readJournalEntriesTool = createReadJournalEntriesTool(workspacePath, queueMessage);

// Custom tools for execute_code
const customTools = {
  addJournalEntry: createAddJournalEntryTool(sessionState, config, workspacePath, queueMessage),
  // ... other tools
};
```

## System Prompt

The following guidance should be included in the system prompt:

```markdown
# Journal Entry System

You have access to a journaling system that allows you to document your work as you go. This helps manage context and provides detailed records of your progress.

## How It Works

### Creating Journal Entries

Use `add_journal_entry({ title })` to mark the start of a new phase of work:

```javascript
// Starting a new meaningful phase
add_journal_entry({ title: "Analyzing authentication system" });

// Later, when focus shifts
add_journal_entry({ title: "Fixing SQL injection vulnerability" });
```

**When to create journal entries:**
- Starting analysis or investigation of a system/problem
- Beginning implementation of a feature or fix
- Running tests or validation
- Writing documentation
- Any time the focus of your work shifts significantly

**Not every tool call needs a new entry.** Create entries at natural phase boundaries, not for every small action.

### Writing to Journals

During code execution, use `tools.addJournalEntry(title, markdown)` to create new journal entries:

```javascript
const vulns = await tools.scanVulnerabilities();

await tools.addJournalEntry(
  "Security Audit Results",
  \`
## Vulnerabilities Found

Total: \${vulns.length}

### Critical Issues:
\${vulns.filter(v => v.severity === 'critical').map(v =>
  \`- \${v.type} in \${v.file}:\${v.line} - \${v.description}\`
).join('\\n')}
  \`
);
```

**What to journal:**
- Detailed findings (lists of errors, vulnerabilities, issues)
- Analysis results
- Implementation details
- Test results
- Decisions and reasoning
- Any information that would clutter the conversation but might be useful later

**Journal content is archived** - it doesn't appear in your context unless you explicitly read it.

### Reading Journals

If you need details from previous journal entries, use `read_journal_entries()` (note: this is a **native tool** you call directly, not through code execution):

```javascript
// Read a single entry
const previousWork = await read_journal_entries({ entryIndices: [0] });

// Read multiple entries at once
const context = await read_journal_entries({ entryIndices: [0, 1, 3] });

// Full journal content is now in your context
```

**When to read journals:**
- You see a compressed message listing previous entries
- You need specific details from earlier work
- You want to review decisions or findings from previous phases

**Important**: This is a native tool call, not a code execution tool. Call it directly like `add_journal_entry()`, not inside `execute_code()`.

## Context Management

The system automatically manages context size based on token usage:

1. **Normal operation**: You work continuously, creating journal entries as you go
2. **Automatic compression**: When context exceeds token threshold (default: 50000), old entries are compressed
3. **Active entry protection**: Your current journal entry is NEVER compressed
4. **Compressed format**: Old work is replaced with a list of available journal entries
5. **On-demand retrieval**: You can read any journal entry in full when needed

**Example of compressed message:**
```
Previous work has been documented in journal entries. You can read entries in detail if needed:

- Entry 0: "Analyzing authentication system"
- Entry 1: "Fixing SQL injection vulnerability"
- Entry 2: "Fixing weak password hashing"

Use read_journal_entries({ entryIndices: [0, 1, ...] }) to retrieve specific entries.
```

When you see this, recent and active work is still in your context, but older work can be retrieved if needed.

## Best Practices

1. **Create entries at natural boundaries** - When starting a new phase, not for every action
2. **Journal liberally** - Put detailed data in journals to keep conversation clean
3. **Use descriptive titles** - Make it easy to identify what each entry contains
4. **Read selectively** - Only retrieve journals you actually need
5. **Structure journal content** - Use markdown headers, lists, and code blocks
6. **Journal incrementally** - Multiple small journal writes as you discover things

## Example Flow

```javascript
// Phase 1: Discovery
add_journal_entry({ title: "Analyzing codebase for type errors" });

execute_code(\`
  const errors = await tools.runTypeChecker();

  // Archive detailed findings
  await tools.addJournalEntry(
    "Type Check Results",
    \\\`
## Errors Found: \\\${errors.length}

### By Severity:
\\\${groupBySeverity(errors).map(([sev, errs]) =>
  \\\`- \\\${sev}: \\\${errs.length}\\\`
).join('\\\\n')}

### Full List:
\\\${errors.map(e => \\\`- \\\${e.file}:\\\${e.line} - \\\${e.message}\\\`).join('\\\\n')}
    \\\`
  );
\`);

// Phase 2: Fixing
add_journal_entry({ title: "Fixing type errors" });

// If I need error details from phase 1
const errorDetails = await read_journal_entries({ entryIndices: [0] });

execute_code(\`
  const fixes = await tools.fixErrors();

  await tools.addJournalEntry(
    "Fixes Applied",
    \\\`Fixed \\\${fixes.length} errors\\\`
  );
\`);
```

## Tool Reference

### add_journal_entry({ title })
**Native tool** - Creates a new journal entry with the given title. Subsequent work is associated with this entry. Call directly (not through execute_code).

### tools.addJournalEntry(title, markdown)
**Custom tool** - Available during code execution. Creates a new journal entry with the given title and markdown content. Fire-and-forget (not added to conversation).

### read_journal_entries({ entryIndices })
**Native tool** - Reads the full contents of one or more journal entries and adds them to the conversation context. Takes an array of entry indices. Call directly (not through execute_code).
```

## Benefits of This Design

### 1. Natural Work Flow
- **No forced planning** - Just work and document as you go
- **Organic structure** - Journal entries emerge at natural boundaries
- **Exploratory-friendly** - Discover problems and create entries reactively

### 2. Automatic Context Management
- **Lazy compression** - Only compress when needed
- **No manual management** - System handles it automatically
- **Predictable behavior** - Clear rules for when compression happens

### 3. Flexible Context Retrieval
- **On-demand detail** - Read compressed entries only when needed
- **Selective loading** - LLM decides what's relevant
- **Full history available** - Nothing is lost, just archived

### 4. Simple Mental Model
- **One conversation** - No switching between isolated contexts
- **Progressive archival** - Old stuff gets compressed, new stuff stays
- **Clear compression format** - Easy to understand what's available

### 5. Configurable Behavior
- **Tune compression threshold** - Adjust for conversation length
- **Tune recent count** - Keep more or less recent context
- **Runtime configuration** - Different settings per request

### 6. Human-Readable Debugging
- **Markdown journals** - Open files and read directly
- **No special tools needed** - Just a text editor
- **Full work history** - Every entry preserved on disk

### 7. Scalable to Long Sessions
- **Context bounded** - Doesn't grow unbounded
- **Proportional to recent work** - Not total work
- **Efficient** - KV cache reused for uncompressed portion

## Advanced Considerations

### Re-reading Compressed Entries

When you read compressed journal entries, they're added back to the conversation:

```typescript
// Before read
messages = [
  { role: "system", ... },
  { role: "assistant", content: "Previous work documented in entries..." },  // Compressed
  { role: "assistant", ... },  // Recent work
]

// After read_journal_entries({ entryIndices: [0, 1] })
messages = [
  { role: "system", ... },
  { role: "assistant", content: "Previous work documented in entries..." },
  { role: "assistant", ... },
  { role: "assistant", content: [read_journal_entries call] },
  { role: "tool", content: "# Entry 0\n\n...\n\n---\n\n# Entry 1\n\n..." }  // Now in context
]
```

This stays in context until the next compression. If you need it again after compression, read it again.

### Reading Multiple Entries

The LLM can read multiple entries in a single call:

```javascript
// Read multiple entries at once (efficient)
const context = await read_journal_entries({ entryIndices: [0, 1, 2] });

// Now has full context from all three phases in one tool call
```

This is more efficient than making separate calls and is useful when working on something that depends on multiple previous phases.

### Journal Size Management

Journals can grow large. Consider strategies:

**Option A: Size warnings**
```typescript
if (getJournalSize(entryIndex) > 100_000) {
  console.warn(`Journal entry ${entryIndex} is very large (${size} bytes)`);
}
```

**Option B: Auto-summarization tool**
```typescript
tools.summarizeJournalEntry = async (entryIndex: number) => {
  const content = await readJournal(entryIndex);
  const summary = await llmSummarize(content);
  await replaceJournal(entryIndex, summary);
};
```

**Recommendation**: Start without limits, monitor real usage patterns.

### KV Cache Efficiency

The compression system is designed for KV cache efficiency:

- **Keeping recent entries uncompressed** - Recent tokens stay in cache
- **Stable prefix** - System message and compressed message rarely change
- **Incremental compression** - Only compress when threshold hit

This means:
- Most turns reuse KV cache for uncompressed portion
- Compression events cause cache miss but happen infrequently
- Net effect: Much better than unbounded context growth

### User Experience

**UI should display:**
- List of journal entries created (breadcrumb trail)
- Current journal entry being worked on (highlighted)
- Indication of compressed vs. active entries

**Example UI:**
```
Journal Entries:
✓ Analyzing authentication system (compressed)
✓ Fixing SQL injection vulnerability (compressed)
✓ Fixing weak password hashing (compressed)
✓ Adding rate limiting (compressed)
→ Running security tests (active)
```

This gives users visibility into progress without seeing all the messages.

## Implementation Checklist

### Core System
- [ ] Create `SessionState` interface with journal entry tracking
- [ ] Create `JournalConfig` interface for configuration options
- [ ] Implement `createAddJournalEntryTool()` native tool factory
- [ ] Implement automatic journal entry index assignment
- [ ] Implement message-to-entry tagging system
- [ ] Create `.journal/` directory on agent initialization
- [ ] Send `journal_entry_created` SSE messages

### Compression System
- [ ] Implement token tracking from API responses (`lastPromptTokens`)
- [ ] Implement `shouldCompress()` logic based on token threshold
- [ ] Implement `performCompression()` to replace old messages
- [ ] Ensure compression excludes active entry (never compress current work)
- [ ] Ensure compression keeps recent K completed entries
- [ ] Implement `createCompressedMessage()` formatting with read_journal_entries syntax
- [ ] Implement `rebuildMessageToEntryMap()` after compression
- [ ] Mark compressed entries in metadata
- [ ] Send `journal_entries_compressed` SSE message with compressed entry details
- [ ] Check for compression after each API call

### Journaling Tools
- [ ] Implement `createAppendJournalEntryTool()` custom tool factory
- [ ] Implement `createReadJournalEntriesTool()` native tool factory (plural)
- [ ] Accept array of entry indices in read tool
- [ ] Send `journal_entries_read` SSE message when reading
- [ ] Handle edge cases (no current entry, missing file, invalid indices)
- [ ] Ensure fire-and-forget behavior for `addJournalEntry`
- [ ] Ensure `read_journal_entries` adds content to messages
- [ ] Format multiple entries with separators

### Configuration
- [ ] Accept `journalConfig` in API endpoint
- [ ] Apply defaults (contextSizeThreshold: 50000, keepRecentCount: 1)
- [ ] Pass config to tool factories
- [ ] Document configuration options

### System Prompt
- [ ] Add journal system explanation to prompt
- [ ] Include guidance on when to create entries
- [ ] Explain compression and reading behavior
- [ ] Provide examples and best practices
- [ ] Document all three tools clearly

### UI/UX
- [ ] Handle `journal_entry_created` SSE messages
- [ ] Handle `journal_entries_read` SSE messages
- [ ] Handle `journal_entries_compressed` SSE messages
- [ ] Display journal entries in UI (list/breadcrumb)
- [ ] Highlight current active entry
- [ ] Show compressed vs. active vs. recent entries
- [ ] Optional: Show visual indicator when entries are compressed
- [ ] Optional: Show when entries are read
- [ ] Optional: Add cleanup on session end

### Testing
- [ ] Test token-based compression triggering
- [ ] Test that active entry is never compressed
- [ ] Test keepRecentCount logic with completed entries
- [ ] Test message-to-entry map rebuilding
- [ ] Test reading single compressed entry
- [ ] Test reading multiple compressed entries in one call
- [ ] Test configuration options (contextSizeThreshold, keepRecentCount)
- [ ] Test edge cases (no entries, all compressed, invalid indices, etc.)
- [ ] Test that compression happens after API calls return token counts
- [ ] Test that `journal_entries_compressed` SSE message is sent with correct entries

## Example End-to-End Flow

### User Request
"Audit the authentication system and fix all vulnerabilities"

### Turn 1-2: Initial Analysis

```javascript
// Turn 1
add_journal_entry({ title: "Analyzing authentication system" });

execute_code(\`
  const files = await tools.findAuthFiles();
  const vulns = await tools.scanVulnerabilities(files);

  await tools.addJournalEntry(
    "Security Audit Results",
    \\\`
## Files Scanned
Found \\\${files.length} auth-related files

## Vulnerabilities Found: \\\${vulns.length}

### Critical (\\\${vulns.critical.length}):
\\\${vulns.critical.map(v => \\\`- \\\${v.type} in \\\${v.file}:\\\${v.line}\\\`).join('\\\\n')}

### Medium (\\\${vulns.medium.length}):
\\\${vulns.medium.map(v => \\\`- \\\${v.type} in \\\${v.file}:\\\${v.line}\\\`).join('\\\\n')}
    \\\`
  );
\`);

// Turn 2
add_journal_entry({ title: "Fixing SQL injection in login" });

execute_code(\`
  const fix = await tools.applySQLFix();

  await tools.addJournalEntry(
    "SQL Injection Fix",
    \\\`Applied fix: \\\${fix.success ? '✓' : '✗'}\\\`
  );
\`);
```

**State:**
- Entry 0: "Analyzing authentication system" (uncompressed)
- Entry 1: "Fixing SQL injection in login" (uncompressed)
- Messages: All messages visible

### Turn 3-5: More Fixes

```javascript
// Turn 3
add_journal_entry({ title: "Updating password hashing to bcrypt" });
// ... work ...

// Turn 4
add_journal_entry({ title: "Adding rate limiting to auth endpoints" });
// ... work ...

// Turn 5
add_journal_entry({ title: "Running security test suite" });
// ... work ...
```

**State after Turn 5:**
- 5 entries created
- Context reaches 54000 tokens (exceeds 50000 threshold)
- **Compression triggers!**
- Entries 0-2 compressed
- Entry 3 kept (recent completed)
- Entry 4 kept (active)
- `journal_entries_compressed` SSE message sent with entries 0-2

**Messages after compression:**
```typescript
[
  { role: "system", ... },
  { role: "user", content: "Audit the authentication system and fix all vulnerabilities" },
  { role: "assistant", content: "Previous work has been documented in journal entries. You can read entries in detail if needed:\n\n- Entry 0: \"Analyzing authentication system\"\n- Entry 1: \"Fixing SQL injection in login\"\n- Entry 2: \"Updating password hashing to bcrypt\"\n\nUse read_journal_entries({ entryIndices: [0, 1, ...] }) to retrieve specific entries." },
  { role: "assistant", content: [add_journal_entry("Adding rate limiting to auth endpoints")] },  // Entry 3
  { role: "tool", ... },
  // ... entry 3 messages ...
  { role: "assistant", content: [add_journal_entry("Running security test suite")] },  // Entry 4 - active
  { role: "tool", ... },
  // ... entry 4 messages continue
]
```

### Turn 6: Tests Fail, Need Context

```javascript
// Tests reveal issues, need to check what was fixed

// Read multiple entries at once
const context = await read_journal_entries({ entryIndices: [0, 1] });

// Now has full context of original vulnerabilities and SQL injection fix
// Can debug test failures with complete information

add_journal_entry({ title: "Debugging test failures" });  // Entry 5 - becomes active

execute_code(\`
  const issues = await tools.analyzeTestFailures();

  await tools.addJournalEntry(
    "Test Failure Analysis",
    \\\`Found \\\${issues.length} issues causing test failures\\\`
  );
\`);
```

### Result

- **6 journal entries** created across multiple phases
- **First 3 entries compressed** into single message (entries 0-2)
- **Entry 3 remained uncompressed** (recent completed)
- **Entry 4 remained uncompressed** (was active)
- **Entry 5 added** (debugging, now active)
- **Context size managed** automatically based on token counts
- **Full detail available** via read_journal_entries()

**Journal files on disk:**
```
.journal/
├── entry-0.md  # 2KB - Analysis with full vulnerability list
├── entry-1.md  # 1KB - SQL injection fix details
├── entry-2.md  # 800B - Password hashing changes
├── entry-3.md  # 1.2KB - Rate limiting implementation
├── entry-4.md  # 3KB - Test suite results
└── entry-5.md  # 1.5KB - Debugging analysis
```

All work is documented, context is manageable, and LLM can retrieve any details when needed.

---

## Conclusion

The journal entry system provides **automatic context management through progressive compression**. By allowing continuous work with natural documentation points and reactively compressing old context, it achieves:

1. **Natural workflow** - No forced task boundaries
2. **Automatic management** - System handles compression
3. **Flexible retrieval** - On-demand detail access
4. **Simple mental model** - One conversation, progressive archival
5. **Configurable behavior** - Tune for different scenarios
6. **Bounded context** - Scales to long conversations
7. **Full history** - Everything preserved on disk

This design is simpler than task-based systems while providing better context management through lazy evaluation and selective retrieval. The LLM works naturally, creating journal entries at meaningful points, while the system automatically ensures context stays manageable.
