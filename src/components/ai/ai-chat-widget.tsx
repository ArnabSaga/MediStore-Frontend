"use client";

import { motion } from "framer-motion";
import { Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AI_CHAT_MAX_CART_ITEMS,
  AiChatError,
  buildAiChatCartFingerprint,
  getAiChatErrorMessage,
  normalizeAiChatCart,
  sendAiChatMessage,
  type AiChatCartItem,
  type AiChatCartProposal,
  type AiChatHistoryMessage,
} from "@/lib/ai-chat";
import { useCartStore } from "@/lib/cart-store";

import {
  AiChatMessage,
  AiChatTypingIndicator,
  AiChatWelcome,
} from "./ai-chat-message";
import { shouldShowAiChat } from "./ai-chat-routes";
import type {
  AiChatRetryPayload,
  AiChatUiMessage,
} from "./ai-chat-types";

let messageSequence = 0;

const nextMessageId = () => `ai-chat-${++messageSequence}`;

const readCartSnapshot = (): AiChatCartItem[] | undefined => {
  const items = useCartStore.getState().items;

  // The backend accepts at most 20 lines. Sending a truncated snapshot would
  // let the model reason about the wrong cart, so fall back to catalog-only
  // mode until the cart fits.
  if (items.length > AI_CHAT_MAX_CART_ITEMS) {
    return undefined;
  }

  return normalizeAiChatCart(
    items.map((item) => ({ medicineId: item.id, quantity: item.qty }))
  );
};

const readCartFingerprint = (): string | null => {
  const items = useCartStore.getState().items;

  if (items.length > AI_CHAT_MAX_CART_ITEMS) {
    return null;
  }

  return buildAiChatCartFingerprint(
    normalizeAiChatCart(
      items.map((item) => ({ medicineId: item.id, quantity: item.qty }))
    )
  );
};

export function AiChatWidget() {
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const appliedProposalsRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const node = listRef.current;

    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, pending, open]);

  const requestAssistant = useCallback(
    async (message: string, history: AiChatHistoryMessage[]) => {
      if (pendingRef.current) {
        return;
      }

      pendingRef.current = true;
      setPending(true);

      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await sendAiChatMessage(
          { message, history, cart: readCartSnapshot() },
          { signal: controller.signal }
        );

        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        setMessages((current) => [
          ...current,
          {
            id: nextMessageId(),
            role: "assistant",
            content: result.answer,
            products: result.products,
            cart: result.cart,
            cartStatus: result.cart?.proposal ? "pending" : undefined,
            fallback: result.meta.fallback,
          },
        ]);
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        if (error instanceof AiChatError && error.kind === "aborted") {
          return;
        }

        setMessages((current) => [
          ...current,
          {
            id: nextMessageId(),
            role: "assistant",
            content: getAiChatErrorMessage(error),
            isError: true,
            retry: { message, history },
          },
        ]);
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          pendingRef.current = false;
          setPending(false);
          abortRef.current = null;
        }
      }
    },
    []
  );

  const sendMessage = useCallback(
    (rawMessage: string) => {
      const message = rawMessage.trim();

      if (!message || pendingRef.current) {
        return;
      }

      const history = messages
        .filter((item) => !item.isError)
        .map(({ role, content }) => ({ role, content }));

      setInput("");
      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: "user", content: message },
      ]);

      void requestAssistant(message, history);
    },
    [messages, requestAssistant]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      sendMessage(input);
    }
  };

  const handleRetry = useCallback(
    (retry: AiChatRetryPayload, messageId: string) => {
      if (pendingRef.current) {
        return;
      }

      setMessages((current) =>
        current.filter((message) => message.id !== messageId)
      );
      void requestAssistant(retry.message, retry.history);
    },
    [requestAssistant]
  );

  const handleConfirmCart = useCallback(
    (messageId: string, proposal: AiChatCartProposal) => {
      if (appliedProposalsRef.current.has(proposal.id)) {
        return;
      }

      const currentFingerprint = readCartFingerprint();

      if (currentFingerprint !== proposal.cartFingerprint) {
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? { ...message, cartStatus: "stale" }
              : message
          )
        );
        return;
      }

      // Claim the proposal before mutating so a rapid double click cannot run
      // the same confirmation twice.
      appliedProposalsRef.current.add(proposal.id);

      if (proposal.action === "CLEAR") {
        useCartStore.getState().clear();
      } else {
        for (const item of proposal.items) {
          useCartStore.getState().setItem(
            {
              id: item.medicineId,
              name: item.name,
              slug: item.slug,
              manufacturer: item.manufacturer,
              price: item.price,
              image: item.imageUrl,
            },
            item.quantity
          );
        }
      }

      setMessages((current) =>
        current.map((message) => {
          if (message.id === messageId) {
            return { ...message, cartStatus: "applied" };
          }

          // Any other pending proposal was built from the cart that just
          // changed, so it can no longer be applied safely.
          if (message.cart?.proposal && message.cartStatus === "pending") {
            return { ...message, cartStatus: "stale" };
          }

          return message;
        })
      );
    },
    []
  );

  const handleCancelCart = useCallback((messageId: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId && message.cartStatus === "pending"
          ? { ...message, cartStatus: "dismissed" }
          : message
      )
    );
  }, []);

  if (!shouldShowAiChat(pathname)) {
    return null;
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open MediStore shopping assistant"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="btn-primary fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex h-14 items-center gap-2 rounded-full px-3 shadow-[0_18px_40px_-14px_rgba(17,138,178,0.55)] sm:right-6 sm:bottom-6 sm:px-5"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="hidden pr-1 text-sm font-semibold sm:inline">
          Ask MediStore
        </span>
      </motion.button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="fixed inset-0 z-50 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-2xl outline-none sm:top-auto sm:right-6 sm:bottom-24 sm:left-auto sm:h-[min(680px,calc(100dvh-8rem))] sm:w-105 sm:max-w-105 sm:rounded-3xl sm:border"
        >
          <header className="relative flex shrink-0 items-center gap-3 border-b border-white/10 bg-[linear-gradient(135deg,var(--button-primary),var(--button-accent))] px-4 py-4 pt-[calc(1rem+env(safe-area-inset-top))] text-white sm:pt-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm font-semibold text-white">
                MediStore Assistant
              </DialogTitle>
              <DialogDescription className="mt-0.5 flex items-center gap-1.5 text-xs text-white/75">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-300"
                  aria-hidden="true"
                />
                Catalog help · online
              </DialogDescription>
            </div>

            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close shopping assistant"
                className="ml-1 h-9 w-9 shrink-0 rounded-xl text-white hover:bg-white/15 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </header>

          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 px-4 py-4"
            aria-live="polite"
            aria-busy={pending}
          >
            {messages.length === 0 && !pending ? (
              <AiChatWelcome onSuggestion={sendMessage} />
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message) => (
                  <AiChatMessage
                    key={message.id}
                    message={message}
                    pending={pending}
                    onRetry={handleRetry}
                    onConfirmCart={handleConfirmCart}
                    onCancelCart={handleCancelCart}
                  />
                ))}
                {pending ? <AiChatTypingIndicator /> : null}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="shrink-0 border-t border-border/70 bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-background p-1.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={1000}
                rows={1}
                placeholder="Ask about a medicine..."
                aria-label="Message the shopping assistant"
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                aria-label="Send message"
                disabled={!input.trim() || pending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Catalog info only - not medical advice.
              </span>
              {input.length > 800 ? (
                <span>
                  {input.length}/{1000}
                </span>
              ) : null}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
