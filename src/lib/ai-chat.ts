import { z } from "zod";

import { apiUrl } from "@/lib/url";

export const AI_CHAT_MAX_HISTORY = 6;
export const AI_CHAT_MAX_MESSAGE_LENGTH = 1000;
export const AI_CHAT_TIMEOUT_MS = 20_000;

const aiChatRoleSchema = z.enum(["user", "assistant"]);

const aiChatStockStatusSchema = z.enum([
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
]);

const aiChatProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string(),
  manufacturer: z.string(),
  price: z.number().finite().nonnegative(),
  stock: z.number().int().nonnegative(),
  inStock: z.boolean(),
  stockStatus: aiChatStockStatusSchema,
  imageUrl: z.string().nullable(),
  category: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  seller: z.object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable(),
  }),
  rating: z.number().finite().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
});

const aiChatResultSchema = z.object({
  answer: z.string(),
  products: z.array(aiChatProductSchema),
  meta: z.object({
    model: z.string(),
    toolCalls: z.number().int().nonnegative(),
    fallback: z.boolean(),
  }),
});

const aiChatEnvelopeSchema = z.object({
  success: z.literal(true),
  data: aiChatResultSchema,
});

export type AiChatHistoryRole = z.infer<typeof aiChatRoleSchema>;

export type AiChatHistoryMessage = {
  role: AiChatHistoryRole;
  content: string;
};

export type AiChatProduct = z.infer<typeof aiChatProductSchema>;
export type AiChatResult = z.infer<typeof aiChatResultSchema>;

export type AiChatErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid";

export class AiChatError extends Error {
  readonly kind: AiChatErrorKind;
  readonly status?: number;

  constructor(
    kind: AiChatErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AiChatError";
    this.kind = kind;
    this.status = options.status;
  }
}

export interface SendAiChatMessageInput {
  message: string;
  history?: AiChatHistoryMessage[];
}

export interface SendAiChatMessageOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function normalizeAiChatHistory(
  history: readonly AiChatHistoryMessage[]
): AiChatHistoryMessage[] {
  return history
    .filter(
      (message) =>
        aiChatRoleSchema.safeParse(message.role).success &&
        typeof message.content === "string"
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, AI_CHAT_MAX_MESSAGE_LENGTH),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-AI_CHAT_MAX_HISTORY);
}

const isAbortError = (error: unknown): boolean => {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError")
  );
};

const readErrorMessage = (payload: unknown): string | undefined => {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }

  return undefined;
};

export async function sendAiChatMessage(
  input: SendAiChatMessageInput,
  options: SendAiChatMessageOptions = {}
): Promise<AiChatResult> {
  const message = input.message.trim();

  if (!message) {
    throw new AiChatError("invalid", "Enter a message to send.");
  }

  if (message.length > AI_CHAT_MAX_MESSAGE_LENGTH) {
    throw new AiChatError(
      "invalid",
      `Messages must be ${AI_CHAT_MAX_MESSAGE_LENGTH} characters or fewer.`
    );
  }

  const history = normalizeAiChatHistory(input.history ?? []);
  const timeoutMs = options.timeoutMs ?? AI_CHAT_TIMEOUT_MS;
  const controller = new AbortController();
  const externalSignal = options.signal;

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const handleExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", handleExternalAbort, {
        once: true,
      });
    }
  }

  try {
    const response = await fetch(apiUrl("/ai/shopping/chat"), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ message, history }),
      signal: controller.signal,
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new AiChatError(
        "http",
        readErrorMessage(payload) ?? `Request failed (${response.status})`,
        { status: response.status }
      );
    }

    const parsed = aiChatEnvelopeSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AiChatError(
        "invalid",
        "The assistant returned an unexpected response."
      );
    }

    return parsed.data.data;
  } catch (error) {
    if (error instanceof AiChatError) {
      throw error;
    }

    if (timedOut) {
      throw new AiChatError(
        "timeout",
        "The assistant took too long to respond.",
        { cause: error }
      );
    }

    if (isAbortError(error)) {
      throw new AiChatError("aborted", "The request was cancelled.", {
        cause: error,
      });
    }

    throw new AiChatError(
      "network",
      "The assistant could not be reached.",
      { cause: error }
    );
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}

export function getAiChatErrorMessage(error: unknown): string {
  if (!(error instanceof AiChatError)) {
    return "Something went wrong. Please try again.";
  }

  if (error.kind === "timeout") {
    return "The assistant took too long to respond. Please try again.";
  }

  if (error.kind === "network") {
    return "I couldn't reach the assistant. Check your connection and try again.";
  }

  if (error.kind === "invalid") {
    return "The assistant sent an unexpected response. Please try again.";
  }

  if (error.kind === "aborted") {
    return "The request was cancelled.";
  }

  switch (error.status) {
    case 400:
      return "Please check your message and try again.";
    case 404:
      return "The shopping assistant isn't available right now.";
    case 429:
      return "You're sending messages too quickly. Please wait a moment and try again.";
    case 502:
    case 503:
      return "The shopping assistant is temporarily unavailable. Please try again.";
    case 504:
      return "The assistant took too long to respond. Please try again.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}

const bdtFormatter = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBdt(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "price unavailable";
  }

  return bdtFormatter.format(value).replace(/\u00a0/g, " ");
}
