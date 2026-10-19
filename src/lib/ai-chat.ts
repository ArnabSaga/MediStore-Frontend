import { z } from "zod";

import { apiUrl } from "@/lib/url";

export const AI_CHAT_MAX_HISTORY = 6;
export const AI_CHAT_MAX_MESSAGE_LENGTH = 1000;
export const AI_CHAT_MAX_CART_ITEMS = 20;
export const AI_CHAT_MAX_CART_QUANTITY = 10_000;
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

const aiChatCartInputItemSchema = z.object({
  medicineId: z.string().trim().min(1),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(AI_CHAT_MAX_CART_QUANTITY),
});

const aiChatCartSellerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  image: z.string().nullable(),
});

const aiChatCartProposalItemSchema = z.object({
  medicineId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string(),
  manufacturer: z.string(),
  price: z.number().finite().nonnegative(),
  stock: z.number().int().nonnegative(),
  imageUrl: z.string().nullable(),
  seller: aiChatCartSellerSchema,
  previousQuantity: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
});

const aiChatCartActionSchema = z.enum(["SET_QTY", "CLEAR"]);

const aiChatCartProposalSchema = z
  .object({
    id: z.string().min(1),
    action: aiChatCartActionSchema,
    items: z.array(aiChatCartProposalItemSchema).max(AI_CHAT_MAX_CART_ITEMS),
    cartFingerprint: z.string().min(1),
  })
  .superRefine((proposal, context) => {
    if (proposal.action === "SET_QTY" && proposal.items.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A quantity proposal needs at least one item.",
      });
    }
  });

const aiChatCartConflictCodeSchema = z.enum([
  "CART_UNAVAILABLE",
  "CART_LIMIT",
  "INVALID_ACTION",
  "INVALID_ITEM",
  "PRODUCT_UNAVAILABLE",
  "INSUFFICIENT_STOCK",
  "SINGLE_SELLER",
  "NO_CHANGE",
]);

const aiChatCartConflictSchema = z.object({
  code: aiChatCartConflictCodeSchema,
  message: z.string().min(1),
});

const aiChatCartSummaryItemSchema = z.object({
  medicineId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string(),
  quantity: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
  inStock: z.boolean(),
  seller: aiChatCartSellerSchema,
});

const aiChatCartSummarySchema = z.object({
  items: z.array(aiChatCartSummaryItemSchema),
  totalItems: z.number().int().nonnegative(),
  singleSeller: z.boolean(),
});

const aiChatCartSchema = z
  .object({
    proposal: aiChatCartProposalSchema.optional(),
    conflict: aiChatCartConflictSchema.optional(),
    summary: aiChatCartSummarySchema.optional(),
  })
  .superRefine((cart, context) => {
    const variants = [
      cart.proposal,
      cart.conflict,
      cart.summary,
    ].filter(Boolean).length;

    if (variants !== 1) {
      context.addIssue({
        code: "custom",
        message: "A cart result must contain exactly one variant.",
      });
    }
  });

const aiChatResultSchema = z.object({
  answer: z.string(),
  products: z.array(aiChatProductSchema),
  cart: aiChatCartSchema.optional(),
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
export type AiChatCartProposalItem = z.infer<
  typeof aiChatCartProposalItemSchema
>;
export type AiChatCartProposal = z.infer<typeof aiChatCartProposalSchema>;
export type AiChatCartConflictCode = z.infer<
  typeof aiChatCartConflictCodeSchema
>;
export type AiChatCartConflict = z.infer<typeof aiChatCartConflictSchema>;
export type AiChatCartSummary = z.infer<typeof aiChatCartSummarySchema>;
export type AiChatCart = z.infer<typeof aiChatCartSchema>;
export type AiChatResult = z.infer<typeof aiChatResultSchema>;

export type AiChatCartItem = {
  medicineId: string;
  quantity: number;
};

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

export function normalizeAiChatCart(
  items: readonly AiChatCartItem[]
): AiChatCartItem[] {
  const byId = new Map<string, AiChatCartItem>();

  for (const item of items) {
    const parsed = aiChatCartInputItemSchema.safeParse(item);

    if (!parsed.success) {
      continue;
    }

    // Last write wins so a tampered duplicate cannot double-count a line.
    byId.set(parsed.data.medicineId, parsed.data);
  }

  if (byId.size > AI_CHAT_MAX_CART_ITEMS) {
    throw new AiChatError(
      "invalid",
      `Your cart is too large for the assistant. It can review up to ${AI_CHAT_MAX_CART_ITEMS} medicines at a time.`
    );
  }

  return [...byId.values()];
}

/**
 * Must match the backend `buildCartFingerprint` byte for byte. Code-unit
 * ordering is used instead of localeCompare so Node and browser ICU agree.
 */
export function buildAiChatCartFingerprint(
  items: readonly AiChatCartItem[]
): string {
  if (items.length === 0) {
    return "empty";
  }

  return [...items]
    .sort((left, right) => {
      if (left.medicineId === right.medicineId) {
        return 0;
      }

      return left.medicineId < right.medicineId ? -1 : 1;
    })
    .map((item) => `${item.medicineId}:${item.quantity}`)
    .join("|");
}

export interface SendAiChatMessageInput {
  message: string;
  history?: AiChatHistoryMessage[];
  /**
   * Current local cart snapshot. The server re-fetches all product facts; only
   * medicine ids and quantities are trusted.
   */
  cart?: AiChatCartItem[];
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
  const cart = input.cart ? normalizeAiChatCart(input.cart) : undefined;
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
      body: JSON.stringify({
        message,
        history,
        ...(cart ? { cart: { items: cart } } : {}),
      }),
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
      return error.message.trim() || "Please check your message and try again.";
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
