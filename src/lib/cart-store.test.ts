import { beforeEach, describe, expect, it } from "vitest";

import { useCartStore } from "./cart-store";

const napa = {
  id: "p1",
  name: "Napa One",
  price: 2.51,
};

beforeEach(() => {
  window.localStorage.clear();
  useCartStore.setState({ items: [] });
});

describe("cart-store setItem", () => {
  it("adds a missing item at the requested quantity", () => {
    useCartStore.getState().setItem(napa, 4);

    const items = useCartStore.getState().items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "p1", qty: 4 });
  });

  it("sets an existing quantity instead of incrementing it", () => {
    useCartStore.getState().add(napa);
    useCartStore.getState().setItem(napa, 3);

    expect(useCartStore.getState().items[0]?.qty).toBe(3);
  });

  it("is idempotent when the same absolute quantity is applied twice", () => {
    useCartStore.getState().add(napa);
    useCartStore.getState().setItem(napa, 2);
    useCartStore.getState().setItem(napa, 2);

    const items = useCartStore.getState().items;

    expect(items).toHaveLength(1);
    expect(items[0]?.qty).toBe(2);
  });

  it("removes an existing item at quantity zero", () => {
    useCartStore.getState().add(napa);
    useCartStore.getState().setItem(napa, 0);

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("ignores a removal for an item that is not in the cart", () => {
    useCartStore.getState().setItem(napa, 0);

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("ignores non-finite quantities", () => {
    useCartStore.getState().add(napa);
    useCartStore.getState().setItem(napa, Number.NaN);
    useCartStore.getState().setItem(napa, Number.POSITIVE_INFINITY);

    expect(useCartStore.getState().items[0]?.qty).toBe(1);
  });
});
