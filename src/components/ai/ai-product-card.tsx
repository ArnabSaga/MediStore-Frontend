"use client";

import { ArrowUpRight, Pill } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { formatBdt, type AiChatProduct } from "@/lib/ai-chat";
import { PRODUCT_IMAGE_MAP } from "@/lib/product-images";
import { cn } from "@/lib/utils";

function resolveProductImage(product: AiChatProduct): string | null {
  const uploaded = product.imageUrl?.trim();

  if (uploaded) {
    return uploaded;
  }

  return PRODUCT_IMAGE_MAP[product.slug] ?? null;
}

function getStockLabel(product: AiChatProduct): string {
  if (
    product.stockStatus === "OUT_OF_STOCK" ||
    !product.inStock ||
    product.stock <= 0
  ) {
    return "Out of stock";
  }

  if (product.stockStatus === "LOW_STOCK") {
    return `Only ${product.stock} left`;
  }

  return "In stock";
}

export function AiProductCard({ product }: { product: AiChatProduct }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = resolveProductImage(product);
  const stockLabel = getStockLabel(product);
  const outOfStock = stockLabel === "Out of stock";
  const lowStock = product.stockStatus === "LOW_STOCK" && !outOfStock;

  return (
    <Link
      href={`/shop/${product.id}`}
      className="group block rounded-2xl border border-border/70 bg-background/70 p-3 transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.04]"
    >
      <div className="flex gap-3">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border/60 bg-muted/60">
          {image && !imageFailed ? (
            <Image
              src={image}
              alt={product.name}
              fill
              sizes="64px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Pill className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-5">
            {product.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {product.manufacturer || "Manufacturer unavailable"}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold tracking-tight">
              {formatBdt(product.price)}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium",
                outOfStock
                  ? "text-muted-foreground"
                  : lowStock
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  outOfStock
                    ? "bg-muted-foreground"
                    : lowStock
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                )}
                aria-hidden="true"
              />
              {stockLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {product.category.name}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          View product
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
