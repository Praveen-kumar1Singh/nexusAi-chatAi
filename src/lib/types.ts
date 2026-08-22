/** One tool the model invoked, plus its result once it comes back. */
export type ToolEvent = {
  name: string;
  args: string;
  result?: string;
};

/** A single turn in the conversation as the UI knows it. */
export type Message = {
  role: "user" | "assistant";
  content: string;
  tools?: ToolEvent[];
  error?: string;
};

/** Sidebar entry. Comes from the agent's in-memory store. */
export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

/** One real tool execution, for the Activity page and audit log. */
export type ActivityEntry = {
  id: string;
  tool: string;
  args: string;
  result: string;
  status: "success" | "failed";
  duration_ms: number;
  at: string;
};

/** A capability the agent actually has, from the Python tool registry. */
export type ToolInfo = {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    description: string;
    options?: string[] | null;
  }[];
  reads: string;
  writes: boolean;
  /** False for tools the model invokes on its own, which stay out of the routing menu. */
  routable?: boolean;
};

/** Fired after a turn creates or updates a conversation, so the sidebar refetches. */
export const CONVERSATIONS_CHANGED = "conversations:changed";
export const SELECT_CONVERSATION = "conversations:select";

/** A text file the user attached, already read in the browser. */
export type Attachment = {
  name: string;
  text: string;
  /** True when the file was longer than the read limit and got cut short. */
  truncated: boolean;
};
