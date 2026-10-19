import type {
  AiChatHistoryMessage,
  AiChatProduct,
} from "@/lib/ai-chat";

export interface AiChatRetryPayload {
  message: string;
  history: AiChatHistoryMessage[];
}

export interface AiChatUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: AiChatProduct[];
  fallback?: boolean;
  isError?: boolean;
  retry?: AiChatRetryPayload;
}

export const AI_CHAT_SUGGESTIONS = [
  "Do you have Napa One?",
  "Show me Napa One and Fexo",
  "Show me allergy medicines",
  "What pain and fever options are available?",
] as const;
