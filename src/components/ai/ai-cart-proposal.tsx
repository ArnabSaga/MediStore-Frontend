"use client";

import { CheckCircle2, ShoppingBasket, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatBdt,
  type AiChatCartConflict,
  type AiChatCartConflictCode,
  type AiChatCartProposal,
  type AiChatCartProposalItem,
} from "@/lib/ai-chat";
import { cn } from "@/lib/utils";

import type { AiChatCartStatus } from "./ai-chat-types";

const CART_CONFLICT_LABELS: Record<AiChatCartConflictCode, string> = {
  CART_UNAVAILABLE: "Cart unavailable",
  CART_LIMIT: "Cart limit reached",
  INVALID_ACTION: "Change not valid",
  INVALID_ITEM: "Product not verified",
  PRODUCT_UNAVAILABLE: "Product unavailable",
  INSUFFICIENT_STOCK: "Not enough stock",
  SINGLE_SELLER: "One seller per order",
  NO_CHANGE: "No change needed",
};

function describeQuantity(item: AiChatCartProposalItem): string {
  if (item.quantity <= 0) {
    return "Remove this item";
  }

  if (item.previousQuantity <= 0) {
    return `Add ${item.quantity}`;
  }

  return `Set quantity to ${item.quantity} (was ${item.previousQuantity})`;
}

export function AiCartProposal({
  proposal,
  status,
  onConfirm,
  onCancel,
}: {
  proposal: AiChatCartProposal;
  status: AiChatCartStatus;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isClear = proposal.action === "CLEAR";

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShoppingBasket className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="text-xs font-semibold">
          {isClear ? "Clear your cart" : "Proposed cart change"}
        </p>
      </div>

      {proposal.items.length > 0 ? (
        <ul className="mt-2.5 space-y-2">
          {proposal.items.map((item) => (
            <li
              key={item.medicineId}
              className="flex items-start justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{item.name}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {describeQuantity(item)}
                  {item.seller.name ? ` - ${item.seller.name}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatBdt(item.price)} each
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          All items will be removed from your cart.
        </p>
      )}

      {status === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg px-3 text-xs"
            onClick={onConfirm}
          >
            Confirm cart change
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg px-3 text-xs"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {status !== "pending" ? (
        <p
          role="status"
          className={cn(
            "mt-2 flex items-start gap-1.5 text-[11px] leading-4",
            status === "applied" && "text-emerald-700 dark:text-emerald-300",
            status === "dismissed" && "text-muted-foreground",
            status === "stale" && "text-amber-700 dark:text-amber-300"
          )}
        >
          {status === "applied" ? (
            <CheckCircle2
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
          ) : null}
          {status === "stale" ? (
            <TriangleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
          ) : null}
          {status === "applied" ? "Cart updated." : null}
          {status === "dismissed"
            ? "Proposal dismissed. Nothing was changed."
            : null}
          {status === "stale"
            ? "Your cart changed since this was proposed. Nothing was applied. Ask again for an updated change."
            : null}
        </p>
      ) : null}
    </div>
  );
}

export function AiCartConflictChip({
  conflict,
}: {
  conflict: AiChatCartConflict;
}) {
  return (
    <p
      role="status"
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"
    >
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
      {CART_CONFLICT_LABELS[conflict.code]}
    </p>
  );
}
