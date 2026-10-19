"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  id: string;
  slug?: string;
  name: string;
  price: number | string;
  manufacturer?: string;
  image?: string | null;
  qty: number;
};

export type AddItemInput = Omit<CartItem, "qty">;

type CartState = {
  items: CartItem[];

  add: (item: AddItemInput) => void;
  remove: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  setItem: (item: AddItemInput, qty: number) => void;
  clear: () => void;

  totalItems: () => number;
  totalAmount: () => number;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (item) => {
        const items = [...get().items];
        const index = items.findIndex((i) => i.id === item.id);

        if (index >= 0) {
          const current = items[index]!;
          items[index] = { ...current, qty: current.qty + 1 };
        } else {
          items.push({ ...item, qty: 1 });
        }

        set({ items });
      },

      remove: (id) => {
        set({ items: get().items.filter((i) => i.id !== id) });
      },

      updateQty: (id, qty) => {
        if (qty <= 0) {
          set({ items: get().items.filter((i) => i.id !== id) });
          return;
        }

        set({
          items: get().items.map((i) => (i.id === id ? { ...i, qty } : i)),
        });
      },

      // Absolute, idempotent quantity set used by AI cart proposals. Repeating
      // the same call produces the same cart, unlike add(). It can also add a
      // missing line, unlike updateQty().
      setItem: (item, qty) => {
        if (!Number.isFinite(qty)) {
          return;
        }

        const quantity = Math.floor(qty);
        const items = get().items;
        const index = items.findIndex((i) => i.id === item.id);

        if (quantity <= 0) {
          if (index >= 0) {
            set({ items: items.filter((i) => i.id !== item.id) });
          }
          return;
        }

        if (index >= 0) {
          set({
            items: items.map((i) =>
              i.id === item.id ? { ...i, qty: quantity } : i
            ),
          });
          return;
        }

        set({ items: [...items, { ...item, qty: quantity }] });
      },

      clear: () => set({ items: [] }),

      totalItems: () => get().items.reduce((sum, item) => sum + item.qty, 0),

      totalAmount: () =>
        get().items.reduce(
          (sum, item) => sum + Number(item.price) * item.qty,
          0
        ),
    }),
    { name: "medistore-cart", version: 1 }
  )
);
