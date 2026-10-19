import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiChatError, type AiChatResult } from "@/lib/ai-chat";
import { sendAiChatMessage } from "@/lib/ai-chat";

import { AiChatWidget } from "./ai-chat-widget";

const navigation = vi.hoisted(() => ({ pathname: "/shop" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("@/lib/ai-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-chat")>();
  return {
    ...actual,
    sendAiChatMessage: vi.fn(),
  };
});

const sendMock = vi.mocked(sendAiChatMessage);

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function openWidget() {
  const user = userEvent.setup();
  render(<AiChatWidget />);
  await user.click(
    screen.getByRole("button", { name: "Open MediStore shopping assistant" })
  );

  return user;
}

beforeEach(() => {
  navigation.pathname = "/shop";
  sendMock.mockReset();
});

describe("AiChatWidget", () => {
  it("renders only on the approved shopping routes", () => {
    navigation.pathname = "/";

    const { rerender } = render(<AiChatWidget />);

    expect(
      screen.getByRole("button", {
        name: "Open MediStore shopping assistant",
      })
    ).toBeInTheDocument();

    navigation.pathname = "/checkout";
    rerender(<AiChatWidget />);

    expect(
      screen.queryByRole("button", {
        name: "Open MediStore shopping assistant",
      })
    ).not.toBeInTheDocument();
  });

  it("opens from the keyboard, exposes accessible controls, and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<AiChatWidget />);

    const launcher = screen.getByRole("button", {
      name: "Open MediStore shopping assistant",
    });

    launcher.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", {
      name: "MediStore Assistant",
    });

    expect(
      within(dialog).getByText("How can I help you shop?")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("Message the shopping assistant")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Send message" })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", {
        name: "Close shopping assistant",
      })
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(
        within(dialog).getByLabelText("Message the shopping assistant")
      ).toHaveFocus()
    );

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("submits a message, shows loading, and renders product cards with BDT prices", async () => {
    const pending = deferred<AiChatResult>();
    sendMock.mockReturnValueOnce(pending.promise);

    const user = await openWidget();
    const textarea = screen.getByLabelText("Message the shopping assistant");

    await user.type(textarea, "Do you have Napa One?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      { message: "Do you have Napa One?", history: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(screen.getByText("Do you have Napa One?")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Assistant is checking the catalog")
    ).toBeInTheDocument();

    await act(async () => {
      pending.resolve(chatResult);
    });

    expect(
      await screen.findByText("Napa One is available.")
    ).toBeInTheDocument();
    expect(screen.getByText("Napa One")).toBeInTheDocument();
    expect(screen.getByText("Beximco")).toBeInTheDocument();
    expect(screen.getByText("BDT 2.51")).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /View product/i })).toHaveAttribute(
      "href",
      "/shop/p1"
    );
    expect(
      screen.queryByRole("button", { name: /add to cart/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/add to cart/i)).not.toBeInTheDocument();
  });

  it("still accepts responses under React Strict Mode", async () => {
    sendMock.mockResolvedValueOnce({
      ...chatResult,
      answer: "Strict Mode answer",
      products: [],
    });

    const user = userEvent.setup();
    render(
      <StrictMode>
        <AiChatWidget />
      </StrictMode>
    );

    await user.click(
      screen.getByRole("button", {
        name: "Open MediStore shopping assistant",
      })
    );
    await user.type(
      screen.getByLabelText("Message the shopping assistant"),
      "hello"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Strict Mode answer")).toBeInTheDocument();
  });

  it("sends prior conversation history with the next message", async () => {
    sendMock
      .mockResolvedValueOnce({
        ...chatResult,
        answer: "First answer",
        products: [],
      })
      .mockResolvedValueOnce({
        ...chatResult,
        answer: "Second answer",
        products: [],
      });

    const user = await openWidget();
    const textarea = screen.getByLabelText("Message the shopping assistant");

    await user.type(textarea, "first");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("First answer")).toBeInTheDocument();

    await user.type(textarea, "second");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Second answer")).toBeInTheDocument();

    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      {
        message: "second",
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "First answer" },
        ],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("shows an error with retry and recovers", async () => {
    sendMock
      .mockRejectedValueOnce(
        new AiChatError("http", "Server error", { status: 500 })
      )
      .mockResolvedValueOnce({
        ...chatResult,
        answer: "Recovered answer",
        products: [],
      });

    const user = await openWidget();
    const textarea = screen.getByLabelText("Message the shopping assistant");

    await user.type(textarea, "hello");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByText(
        "Something went wrong on our side. Please try again."
      )
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Try again/i }));

    expect(await screen.findByText("Recovered answer")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Something went wrong on our side. Please try again."
      )
    ).not.toBeInTheDocument();
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      { message: "hello", history: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it.each<[AiChatError, string]>([
    [new AiChatError("http", "", { status: 429 }), "too quickly"],
    [new AiChatError("timeout", ""), "took too long"],
    [new AiChatError("network", ""), "couldn't reach"],
    [new AiChatError("http", "", { status: 504 }), "took too long"],
  ])("shows a friendly message for %#", async (error, expected) => {
    sendMock.mockRejectedValueOnce(error);

    const user = await openWidget();
    await user.type(
      screen.getByLabelText("Message the shopping assistant"),
      "hello"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByText(new RegExp(expected, "i"))
    ).toBeInTheDocument();
  });

  it("renders fallback answers normally with a catalog-only marker", async () => {
    sendMock.mockResolvedValueOnce({
      ...chatResult,
      answer: "I couldn't find a matching medicine.",
      products: [],
      meta: { ...chatResult.meta, fallback: true },
    });

    const user = await openWidget();
    await user.type(
      screen.getByLabelText("Message the shopping assistant"),
      "unknown product"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByText("I couldn't find a matching medicine.")
    ).toBeInTheDocument();
    expect(screen.getByText("Catalog-only answer")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Try again/i })
    ).not.toBeInTheDocument();
  });

  it("renders assistant content as plain text and never executes HTML", async () => {
    const injected =
      '<img src="x" onerror="window.__xss = true"> **not bold**';
    sendMock.mockResolvedValueOnce({
      ...chatResult,
      answer: injected,
      products: [],
    });

    const user = await openWidget();
    await user.type(
      screen.getByLabelText("Message the shopping assistant"),
      "show me html"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    const bubble = await screen.findByText(injected);

    expect(bubble.textContent).toBe(injected);
    expect(bubble.querySelector("strong")).toBeNull();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(
      (window as Window & { __xss?: boolean }).__xss
    ).toBeUndefined();
  });

  it("prevents duplicate submissions while a request is pending", async () => {
    const pending = deferred<AiChatResult>();
    sendMock.mockReturnValueOnce(pending.promise);

    const user = await openWidget();
    const textarea = screen.getByLabelText("Message the shopping assistant");
    const sendButton = screen.getByRole("button", { name: "Send message" });

    await user.type(textarea, "first");
    await user.click(sendButton);

    await user.type(textarea, "second{Enter}");
    await user.type(textarea, "third");
    await user.click(sendButton);

    expect(sendMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(chatResult);
    });
  });

  it("blocks empty input and caps message length", async () => {
    const user = await openWidget();
    const textarea = screen.getByLabelText("Message the shopping assistant");
    const sendButton = screen.getByRole("button", { name: "Send message" });

    expect(sendButton).toBeDisabled();
    expect(textarea).toHaveAttribute("maxlength", "1000");

    await user.type(textarea, "   ");
    expect(sendButton).toBeDisabled();

    await user.keyboard("{Enter}");

    expect(sendMock).not.toHaveBeenCalled();
  });
});
