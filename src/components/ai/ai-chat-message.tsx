"use client";

import {
  ArrowUpRight,
  CircleAlert,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AiChatCartProposal } from "@/lib/ai-chat";
import { cn } from "@/lib/utils";

import { AiCartConflictChip, AiCartProposal } from "./ai-cart-proposal";
import { AiProductCard } from "./ai-product-card";
import {
  AI_CHAT_SUGGESTIONS,
  type AiChatRetryPayload,
  type AiChatUiMessage,
} from "./ai-chat-types";

export function AiChatMessage({
  message,
  pending,
  onRetry,
  onConfirmCart,
  onCancelCart,
}: {
  message: AiChatUiMessage;
  pending: boolean;
  onRetry: (retry: AiChatRetryPayload, messageId: string) => void;
  onConfirmCart: (
    messageId: string,
    proposal: AiChatCartProposal
  ) => void;
  onCancelCart: (messageId: string) => void;
}) {
  const isUser = message.role === "user";
  const retry = message.retry;
  const proposal = message.cart?.proposal;
  const conflict = message.cart?.conflict;

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-sm",
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border border-border/70 bg-card text-card-foreground",
          message.isError &&
            "border-destructive/30 bg-destructive/5 text-destructive"
        )}
      >
        <div className="flex items-start gap-2">
          {message.isError ? (
            <CircleAlert
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
          ) : null}
          <p className="whitespace-pre-wrap wrap-break-word leading-6">
            {message.content}
          </p>
        </div>

        {message.products && message.products.length > 0 ? (
          <div className="mt-3 space-y-2">
            {message.products.map((product) => (
              <AiProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : null}

        {proposal ? (
          <AiCartProposal
            proposal={proposal}
            status={message.cartStatus ?? "pending"}
            onConfirm={() => onConfirmCart(message.id, proposal)}
            onCancel={() => onCancelCart(message.id)}
          />
        ) : null}

        {conflict ? <AiCartConflictChip conflict={conflict} /> : null}

        {message.fallback ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Catalog-only answer
          </p>
        ) : null}

        {retry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-8 rounded-lg border-destructive/30 bg-background/70 text-xs text-foreground"
            onClick={() => onRetry(retry, message.id)}
            disabled={pending}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AiChatTypingIndicator() {
  return (
    <div
      className="mr-auto flex max-w-[90%] items-center gap-2 rounded-2xl rounded-bl-md border border-border/70 bg-card px-4 py-3"
      aria-label="Assistant is checking the catalog"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground">
        Checking the catalog…
      </span>
    </div>
  );
}

export function AiChatWelcome({
  onSuggestion,
}: {
  onSuggestion: (suggestion: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-5 py-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
        <Sparkles className="h-7 w-7" aria-hidden="true" />
      </div>

      <h3 className="text-lg font-semibold tracking-tight">
        How can I help you shop?
      </h3>
      <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
        Search the MediStore catalog, compare products, and check verified
        prices and stock.
      </p>

      <div className="mt-6 grid w-full gap-2">
        {AI_CHAT_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSuggestion(suggestion)}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-left text-xs font-medium transition-colors hover:border-primary/30 hover:bg-primary/5"
          >
            <span>{suggestion}</span>
            <ArrowUpRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>

      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Catalog information only - not medical advice.
      </p>
    </div>
  );
}
