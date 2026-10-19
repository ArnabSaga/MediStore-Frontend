import { describe, expect, it } from "vitest";

import { shouldShowAiChat } from "./ai-chat-routes";

describe("shouldShowAiChat", () => {
  it.each([
    "/",
    "/shop",
    "/shop/",
    "/shop/napa-one",
    "/shop/64f1c2a9",
    "/shop/napa-one/",
  ])("shows the assistant on %s", (pathname) => {
    expect(shouldShowAiChat(pathname)).toBe(true);
  });

  it.each([
    null,
    undefined,
    "",
    "/cart",
    "/checkout",
    "/account",
    "/account/orders",
    "/shop/napa-one/reviews",
    "/seller",
    "/admin",
  ])("hides the assistant on %s", (pathname) => {
    expect(shouldShowAiChat(pathname)).toBe(false);
  });
});
