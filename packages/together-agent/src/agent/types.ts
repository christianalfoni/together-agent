export type AgentMessage =
  | DiscoverToolsMessage
  | CodeExecutionStartedMessage
  | CodeExecutionCompletedMessage
  | CustomToolCallStartedMessage
  | CustomToolCallCompletedMessage
  | ApprovalRequestMessage
  | TextMessage
  | ErrorMessage
  | DoneMessage;

// Native tool messages
export interface DiscoverToolsMessage {
  type: "discover_tools";
  query: string;
  matchedTools: string[];
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
}

// Approval messages
export interface ApprovalRequestMessage {
  type: "approval_request";
  approvalId: string;
  payload: any;
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
