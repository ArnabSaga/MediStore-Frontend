import type {
  AiChatCart,
  AiChatHistoryMessage,
  AiChatProduct,
} from "@/lib/ai-chat";

export interface AiChatRetryPayload {
  message: string;
  history: AiChatHistoryMessage[];
}

export type AiChatCartStatus =
  | "pending"
  | "applied"
  | "dismissed"
  | "stale";

export interface AiChatUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: AiChatProduct[];
  cart?: AiChatCart;
  cartStatus?: AiChatCartStatus;
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
