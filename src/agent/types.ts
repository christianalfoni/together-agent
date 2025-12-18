export type AgentMessage =
  | ToolCallRequestedMessage
  | ToolCallCompletedMessage
  | TextMessage
  | ErrorMessage
  | DoneMessage;

export interface ToolCallRequestedMessage {
  type: "tool_call_requested";
  toolName: string;
  args: any;
  callId: string;
}

export interface ToolCallCompletedMessage {
  type: "tool_call_completed";
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
  sessionId: string;
}
