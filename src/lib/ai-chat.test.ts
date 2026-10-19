import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_CHAT_MAX_CART_ITEMS,
  AI_CHAT_MAX_CART_QUANTITY,
  AI_CHAT_MAX_HISTORY,
  AI_CHAT_MAX_MESSAGE_LENGTH,
  AiChatError,
  buildAiChatCartFingerprint,
  formatBdt,
  getAiChatErrorMessage,
  normalizeAiChatCart,
  normalizeAiChatHistory,
  sendAiChatMessage,
  type AiChatHistoryMessage,
  type AiChatResult,
} from "./ai-chat";

const product = {
  id: "p1",
  name: "Napa One",
  slug: "napa-one",
  manufacturer: "Beximco",
  price: 2.51,
  stock: 12,
  inStock: true,
  stockStatus: "IN_STOCK" as const,
  imageUrl: null,
  category: { id: "c1", name: "Pain Relief", slug: "pain-relief" },
  seller: { id: "s1", name: "MediStore", image: null },
  rating: 4.5,
  reviewCount: 10,
};

const chatResult: AiChatResult = {
  answer: "Napa One is available.",
  products: [product],
  meta: { model: "test-model", toolCalls: 1, fallback: false },
};

const cartProposal = {
  id: "proposal-1",
  action: "SET_QTY" as const,
  items: [
    {
      medicineId: "p1",
      name: "Napa One",
      slug: "napa-one",
      manufacturer: "Beximco",
      price: 2.51,
      stock: 12,
      imageUrl: null,
      seller: { id: "s1", name: "MediStore", image: null },
      previousQuantity: 1,
      quantity: 3,
    },
  ],
  cartFingerprint: "p1:1",
};

const cartConflict = {
  code: "SINGLE_SELLER" as const,
  message:
    "For now, one order can contain medicines from only one seller. Remove items from the other seller and try again.",
};

const makeFetchResponse = (
  payload: unknown,
  init: { ok?: boolean; status?: number } = {}
): Response =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(payload),
  }) as unknown as Response;

const makeHistory = (count: number): AiChatHistoryMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: ` message ${index} `,
  }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatBdt", () => {
  it("formats prices as BDT with two decimals", () => {
    expect(formatBdt(2.51)).toBe("BDT 2.51");
    expect(formatBdt(1250)).toBe("BDT 1,250.00");
  });

  it("returns a safe label for invalid prices", () => {
    expect(formatBdt(-1)).toBe("price unavailable");
    expect(formatBdt(Number.NaN)).toBe("price unavailable");
    expect(formatBdt(Number.POSITIVE_INFINITY)).toBe("price unavailable");
  });
});

describe("normalizeAiChatHistory", () => {
  it("keeps only the last six trimmed, non-empty messages", () => {
    const normalized = normalizeAiChatHistory([
      ...makeHistory(8),
      { role: "user", content: "   " },
    ]);

    expect(normalized).toHaveLength(AI_CHAT_MAX_HISTORY);
    expect(normalized[0]).toEqual({ role: "user", content: "message 2" });
    expect(normalized[5]).toEqual({ role: "assistant", content: "message 7" });
  });

  it("drops invalid roles and caps content length", () => {
    const normalized = normalizeAiChatHistory([
      { role: "system" as unknown as "user", content: "skip me" },
      { role: "assistant", content: "x".repeat(1200) },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].content).toHaveLength(AI_CHAT_MAX_MESSAGE_LENGTH);
  });
});

describe("sendAiChatMessage", () => {
  it("posts only the accepted fields through the local proxy", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ success: true, data: chatResult })
    );

    const result = await sendAiChatMessage({
      message: "  Do you have Napa One?  ",
      history: [{ role: "user", content: " hello " }],
    });

    expect(result).toEqual(chatResult);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(url).toBe("/api/v1/ai/shopping/chat");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(body).toEqual({
      message: "Do you have Napa One?",
      history: [{ role: "user", content: "hello" }],
    });
    expect(Object.keys(body)).toEqual(["message", "history"]);
    expect(String(init.body)).not.toMatch(/gemini|api[_-]?key/i);
  });

  it("sends the current cart snapshot without trusting product facts", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ success: true, data: chatResult })
    );

    await sendAiChatMessage({
      message: "make napa 3",
      cart: [
        { medicineId: "p2", quantity: 1 },
        { medicineId: "p1", quantity: 2 },
      ],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(body).toEqual({
      message: "make napa 3",
      history: [],
      cart: {
        items: [
          { medicineId: "p2", quantity: 1 },
          { medicineId: "p1", quantity: 2 },
        ],
      },
    });
    expect(Object.keys(body)).toEqual(["message", "history", "cart"]);
  });

  it("does not send a cart field when no cart is provided", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ success: true, data: chatResult })
    );

    await sendAiChatMessage({ message: "hello" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(["message", "history"]);
  });

  it("limits history to six messages before sending", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ success: true, data: chatResult })
    );

    await sendAiChatMessage({
      message: "hello",
      history: makeHistory(9),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      history: AiChatHistoryMessage[];
    };

    expect(body.history).toHaveLength(AI_CHAT_MAX_HISTORY);
  });

  it("rejects empty and oversized messages without calling fetch", async () => {
    await expect(
      sendAiChatMessage({ message: "   " })
    ).rejects.toMatchObject({ kind: "invalid" });

    await expect(
      sendAiChatMessage({ message: "x".repeat(AI_CHAT_MAX_MESSAGE_LENGTH + 1) })
    ).rejects.toMatchObject({ kind: "invalid" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps HTTP failures to typed errors", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(
        { message: "Too many requests" },
        { ok: false, status: 429 }
      )
    );

    const error = await sendAiChatMessage({ message: "hello" }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(AiChatError);
    expect(error).toMatchObject({
      kind: "http",
      status: 429,
      message: "Too many requests",
    });
    expect(getAiChatErrorMessage(error)).toContain("too quickly");
  });

  it("uses a generic message when an error response has no message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse(null, { ok: false, status: 500 })
    );

    await expect(sendAiChatMessage({ message: "hello" })).rejects.toMatchObject(
      {
        kind: "http",
        status: 500,
        message: "Request failed (500)",
      }
    );
  });

  it("accepts a verified cart proposal response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        success: true,
        data: {
          ...chatResult,
          answer: "I can make that cart change.",
          products: [],
          cart: { proposal: cartProposal },
        },
      })
    );

    const result = await sendAiChatMessage({ message: "make napa 3" });

    expect(result.cart).toEqual({ proposal: cartProposal });
  });

  it("accepts a clear proposal that lists the removed items", async () => {
    const clearProposal = {
      ...cartProposal,
      action: "CLEAR" as const,
      items: [{ ...cartProposal.items[0], quantity: 0 }],
    };

    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        success: true,
        data: {
          ...chatResult,
          answer: "I can empty your cart.",
          products: [],
          cart: { proposal: clearProposal },
        },
      })
    );

    const result = await sendAiChatMessage({ message: "clear my cart" });

    expect(result.cart).toEqual({ proposal: clearProposal });
  });

  it("accepts a cart conflict response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        success: true,
        data: {
          ...chatResult,
          answer: cartConflict.message,
          products: [],
          cart: { conflict: cartConflict },
        },
      })
    );

    const result = await sendAiChatMessage({ message: "add another seller" });

    expect(result.cart).toEqual({ conflict: cartConflict });
  });

  it("accepts a cart summary response", async () => {
    const summary = {
      items: [
        {
          medicineId: "p1",
          name: "Napa One",
          slug: "napa-one",
          quantity: 2,
          stock: 12,
          inStock: true,
          seller: { id: "s1", name: "MediStore", image: null },
        },
      ],
      totalItems: 2,
      singleSeller: true,
    };

    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        success: true,
        data: {
          ...chatResult,
          answer: "Your cart has 2 items.",
          products: [],
          cart: { summary },
        },
      })
    );

    const result = await sendAiChatMessage({ message: "what is in my cart?" });

    expect(result.cart).toEqual({ summary });
  });

  it.each<[string, unknown]>([
    ["two cart variants", { proposal: cartProposal, conflict: cartConflict }],
    ["no cart variant", {}],
    [
      "an empty SET_QTY proposal",
      { proposal: { ...cartProposal, items: [] } },
    ],
    [
      "an unknown action",
      { proposal: { ...cartProposal, action: "INCREMENT" } },
    ],
    [
      "a fractional proposed quantity",
      {
        proposal: {
          ...cartProposal,
          items: [{ ...cartProposal.items[0], quantity: 1.5 }],
        },
      },
    ],
  ])("rejects %s in a cart response", async (_label, cart) => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        success: true,
        data: {
          ...chatResult,
          answer: "Malformed cart.",
          products: [],
          cart,
        },
      })
    );

    await expect(sendAiChatMessage({ message: "hello" })).rejects.toMatchObject(
      { kind: "invalid" }
    );
  });

  it("rejects an oversized cart snapshot before calling fetch", async () => {
    const cart = Array.from(
      { length: AI_CHAT_MAX_CART_ITEMS + 1 },
      (_, index) => ({
        medicineId: `p${index}`,
        quantity: 1,
      })
    );

    await expect(
      sendAiChatMessage({ message: "hello", cart })
    ).rejects.toMatchObject({ kind: "invalid" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed response envelopes", async () => {
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ success: true, data: { answer: 123 } })
    );

    await expect(sendAiChatMessage({ message: "hello" })).rejects.toMatchObject(
      { kind: "invalid" }
    );
  });

  it("rejects responses that are not valid JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error("bad json")),
    } as unknown as Response);

    await expect(sendAiChatMessage({ message: "hello" })).rejects.toMatchObject(
      { kind: "invalid" }
    );
  });

  it("maps network failures to a typed network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(sendAiChatMessage({ message: "hello" })).rejects.toMatchObject(
      { kind: "network" }
    );
  });

  it("aborts with a timeout when the backend is too slow", async () => {
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    await expect(
      sendAiChatMessage({ message: "hello" }, { timeoutMs: 10 })
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("supports caller-initiated aborts", async () => {
    const controller = new AbortController();

    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    const request = sendAiChatMessage(
      { message: "hello" },
      { signal: controller.signal }
    );

    controller.abort();

    await expect(request).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("cart helpers", () => {
  it("deduplicates ids and drops unusable lines", () => {
    expect(
      normalizeAiChatCart([
        { medicineId: "p1", quantity: 1 },
        { medicineId: "p1", quantity: 3 },
        { medicineId: "p2", quantity: 0 },
        { medicineId: "p3", quantity: 2.5 },
        { medicineId: "   ", quantity: 1 },
        { medicineId: "p4", quantity: AI_CHAT_MAX_CART_QUANTITY + 1 },
      ])
    ).toEqual([{ medicineId: "p1", quantity: 3 }]);
  });

  it("rejects a cart above the backend limit", () => {
    const items = Array.from(
      { length: AI_CHAT_MAX_CART_ITEMS + 1 },
      (_, index) => ({ medicineId: `p${index}`, quantity: 1 })
    );

    expect(() => normalizeAiChatCart(items)).toThrowError(AiChatError);
  });

  it("builds a fingerprint in code-unit order regardless of input order", () => {
    const expected = buildAiChatCartFingerprint([
      { medicineId: "p1", quantity: 2 },
      { medicineId: "p2", quantity: 1 },
    ]);

    expect(expected).toBe("p1:2|p2:1");
    expect(
      buildAiChatCartFingerprint([
        { medicineId: "p2", quantity: 1 },
        { medicineId: "p1", quantity: 2 },
      ])
    ).toBe(expected);

    // Code-unit ordering puts uppercase B before lowercase a.
    expect(
      buildAiChatCartFingerprint([
        { medicineId: "a", quantity: 1 },
        { medicineId: "B", quantity: 2 },
      ])
    ).toBe("B:2|a:1");
  });

  it("uses the empty sentinel for an empty cart", () => {
    expect(buildAiChatCartFingerprint([])).toBe("empty");
  });
});

describe("getAiChatErrorMessage", () => {
  it.each<[AiChatError, string]>([
    [new AiChatError("http", "", { status: 400 }), "check your message"],
    [new AiChatError("http", "", { status: 404 }), "isn't available"],
    [new AiChatError("http", "", { status: 429 }), "too quickly"],
    [new AiChatError("http", "", { status: 500 }), "went wrong"],
    [new AiChatError("http", "", { status: 502 }), "temporarily unavailable"],
    [new AiChatError("http", "", { status: 503 }), "temporarily unavailable"],
    [new AiChatError("http", "", { status: 504 }), "took too long"],
    [new AiChatError("network", ""), "couldn't reach"],
    [new AiChatError("timeout", ""), "took too long"],
    [new AiChatError("invalid", ""), "unexpected response"],
    [new AiChatError("aborted", ""), "cancelled"],
    [new AiChatError("http", "", { status: 418 }), "went wrong"],
  ])("returns a friendly message for %#", (error, expected) => {
    expect(getAiChatErrorMessage(error)).toContain(expected);
  });

  it("handles unknown errors", () => {
    expect(getAiChatErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("surfaces a specific backend 400 message", () => {
    expect(
      getAiChatErrorMessage(
        new AiChatError(
          "http",
          "Your cart includes a medicine that is no longer available in the catalog. Remove it from your cart and try again.",
          { status: 400 }
        )
      )
    ).toContain("no longer available");
  });
});
