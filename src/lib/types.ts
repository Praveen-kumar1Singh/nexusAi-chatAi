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
  /** False when the tool is configured off (no key), so it is not offered to the model. */
  available?: boolean;
};

/** One picture the image tool produced, as the agent describes it. */
export type GeneratedImage = {
  /** Path on this origin -- /api/images/<id>. Never the provider's own link. */
  url: string;
  prompt: string;
  width: number;
  height: number;
  size: string;
  style?: string;
  seed?: number;
  provider: string;
  model: string;
  created_at?: string;
};

export type ImageQuota = {
  plan: "free" | "paid" | "none";
  maxImages: number;
  usedImages: number;
  remainingImages: number;
  canGenerate: boolean;
};

/** Which image model the agent will call, plus this account's recent work and quota. */
export type ImageToolStatus = {
  available: boolean;
  provider: string;
  model: string;
  key_loaded: boolean;
  sizes: string[];
  styles: string[];
  recent?: GeneratedImage[];
  quota?: ImageQuota;
};

/** One clip the video tool produced, as the agent describes it. */
export type GeneratedVideo = {
  /** Path on this origin -- /api/videos/<id>. Never the provider's own link. */
  url: string;
  prompt: string;
  /** Length in seconds, as generated -- may be shorter than requested if the
   *  configured model could not reach the asked-for rung. */
  duration: number;
  aspect: string;
  aspect_ratio: string;
  resolution?: string;
  style?: string;
  audio?: boolean;
  provider: string;
  model: string;
  cost_usd?: number;
  created_at?: string;
};

export type VideoQuota = {
  plan: "free" | "paid" | "none";
  maxVideos: number;
  usedVideos: number;
  remainingVideos: number;
  canGenerate: boolean;
};

/** What the video tool is configured to do, from the Python side. */
export type VideoToolStatus = {
  available: boolean;
  provider: string;
  model: string;
  key_loaded: boolean;
  /** Only the lengths the configured model can actually produce. */
  durations: number[];
  default_duration: number;
  aspects: string[];
  resolutions: string[];
  styles: string[];
  cost_per_second: number;
  /** Set when the tool is off, explaining why. Empty when it is working. */
  note?: string;
  recent?: GeneratedVideo[];
  quota?: VideoQuota;
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
