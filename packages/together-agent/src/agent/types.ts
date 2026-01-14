export type AgentMessage =
  | DiscoverCodeToolsMessage
  | CodeExecutionStartedMessage
  | CodeExecutionCompletedMessage
  | CustomToolCallStartedMessage
  | CustomToolCallCompletedMessage
  | ApprovalRequestMessage
  | JournalEntryCreatedMessage
  | JournalEntriesReadMessage
  | JournalEntriesCompressedMessage
  | TextMessage
  | ErrorMessage
  | DoneMessage
  | DebugMessage;

// Native tool messages
export interface DiscoverCodeToolsMessage {
  type: "discover_code_tools";
  terms: string;
  matchedTools: Array<{
    name: string;
    discoveryTerms: string[];
  }>;
}

export interface CodeExecutionStartedMessage {
  type: "code_execution_started";
  code: string;
}

export interface CodeExecutionCompletedMessage {
  type: "code_execution_completed";
  result?: string;
  error?: string;
}

// Custom tool messages (user-defined tools)
export interface CustomToolCallStartedMessage {
  type: "custom_tool_call_started";
  toolName: string;
  args: any;
  callId: string;
}

export interface CustomToolCallCompletedMessage {
  type: "custom_tool_call_completed";
  toolName: string;
  callId: string;
  result?: any;
  error?: string;
}

export interface TextMessage {
  type: "text";
  content: string;
}

export interface ErrorMessage {
  type: "error";
  error: string;
}

export interface DoneMessage {
  type: "done";
  // Token breakdown for cost tracking
  contextSize?: number;  // Current conversation size (can decrease after compression)
  cumulativeInput?: number;  // Total input tokens sent across all turns
  cumulativeOutput?: number;  // Total output tokens generated across all turns
  turns?: number;
  totalTurns?: number;
}

export interface DebugMessage {
  type: "debug";
  messages: Array<{
    role: string;
    content: any;
  }>;
  messageCount: number;
}

// Approval messages
export interface ApprovalRequestMessage {
  type: "approval_request";
  approvalId: string;
  payload: any;
}

// Journal messages
export interface JournalEntryCreatedMessage {
  type: "journal_entry_created";
  entryIndex: number;
  title: string;
}

export interface JournalEntriesReadMessage {
  type: "journal_entries_read";
  entryIndices: number[];
}

export interface JournalEntriesCompressedMessage {
  type: "journal_entries_compressed";
  compressedEntries: Array<{ index: number; title: string }>;
}

export interface ApprovalResponse {
  approvalId: string;
  approved: boolean;
}

export interface PendingApproval {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  timestamp: number;
}

// Tool execution context
export interface ToolExecutionContext {
  secrets: Record<string, string>;
  requestApproval: (payload: any, timeoutMs?: number) => Promise<void>;
  workspacePath: string;
}

// Journal entry system
export interface JournalEntry {
  index: number;
  title: string;
  compressed: boolean;
  filePath: string;
}

export interface JournalConfig {
  contextSizeThreshold: number;  // Default: 50000
}

export interface DiscoveredTool {
  name: string;
  inputSchema: any;
  outputSchema: any;
}

export interface SessionState {
  messages: any[];  // CoreMessage[] imported from 'ai'
  journalEntries: JournalEntry[];
  messageToJournals: Map<any, number[]>;  // Maps message object to journal entry indices
  lastUserOrAssistantMessage: any | null;  // Track last user/assistant message for journal attachment
  lastPromptTokens: number;  // Input tokens from last turn (for compression check)
  cumulativeInputTokens: number;  // Total input tokens sent across all turns (for cost tracking)
  cumulativeOutputTokens: number;  // Total output tokens generated across all turns (for cost tracking)
  discoveredTools: Map<string, DiscoveredTool>;  // Maps tool name to tool definition
  executionContext: Record<string, any>;  // Accumulated variables from code executions - returned values become available as globals
  customPrompt?: string;  // Custom base prompt from AGENT.md (loaded once at start)
}
