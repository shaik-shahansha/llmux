/**
 * OpenAI-compatible request/response types for LLMux.
 * These mirror the OpenAI API surface so any OpenAI SDK client
 * works without modification.
 */

// ── Shared ────────────────────────────────────────────────────────────────────

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ── Chat Completions ──────────────────────────────────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  n?: number;
  user?: string;
  tools?: Tool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
  response_format?: { type: "text" | "json_object" | "json_schema"; json_schema?: unknown };
  seed?: number;
  logprobs?: boolean;
  top_logprobs?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  logprobs?: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: Usage;
  system_fingerprint?: string;
}

// ── Streaming ─────────────────────────────────────────────────────────────────

export interface ChatCompletionChunkDelta {
  role?: Role;
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  logprobs?: unknown;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: Partial<Usage>;
}

// ── Legacy Completions ────────────────────────────────────────────────────────

export interface CompletionRequest {
  model: string;
  prompt: string | string[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

export interface CompletionChoice {
  text: string;
  index: number;
  finish_reason: string | null;
  logprobs?: unknown;
}

export interface CompletionResponse {
  id: string;
  object: "text_completion";
  created: number;
  model: string;
  choices: CompletionChoice[];
  usage: Usage;
}

// ── Images ────────────────────────────────────────────────────────────────────

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  n?: number;
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792";
  quality?: "standard" | "hd";
  response_format?: "url" | "b64_json";
  style?: "vivid" | "natural";
  user?: string;
}

export interface ImageObject {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface ImageGenerationResponse {
  created: number;
  data: ImageObject[];
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export interface AudioTranscriptionResponse {
  text: string;
  task?: string;
  language?: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: unknown[];
}

export interface AudioSpeechRequest {
  model: string;
  input: string;
  voice: string;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number;
}

// ── Models ────────────────────────────────────────────────────────────────────

export interface ModelObject {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelListResponse {
  object: "list";
  data: ModelObject[];
}

// ── Errors ────────────────────────────────────────────────────────────────────

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
}
