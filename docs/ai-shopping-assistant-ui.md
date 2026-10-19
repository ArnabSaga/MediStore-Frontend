# AI Shopping Assistant UI

## Scope

Phase 1 added a floating, catalog-grounded shopping assistant to the MediStore storefront. Phase 2 extends the same widget with backend-validated cart proposals that apply only after explicit user confirmation.

- Backend endpoint: `POST /api/v1/ai/shopping/chat`
- Browser transport: the existing same-origin Next.js proxy at `src/app/api/v1/[...path]/route.ts`
- Provider access: backend only. The frontend never calls Gemini directly and never handles provider credentials.
- Shopping behavior: the assistant can search the catalog and propose cart changes. The user must confirm a proposal before the Zustand cart changes. The assistant never places orders and never changes checkout or payment data.
- Cart truth: the browser sends only medicine IDs and quantities. The backend re-fetches products from PostgreSQL and validates visibility, stock, quantity, and single-seller compatibility.

## Route Visibility

The widget is mounted once in `src/app/(public)/layout.tsx` and decides visibility from `usePathname()`.

| Route | Visible | Reason |
|---|:---:|---|
| `/` | Yes | Product discovery |
| `/shop` | Yes | Product discovery |
| `/shop/[id]` | Yes | Product detail context |
| `/cart` | No | Cart and checkout stay focused |
| `/checkout` | No | Cart and checkout stay focused |
| `/account/**` | No | Account surfaces stay focused |
| `/seller/**`, `/admin/**` | No | Operational surfaces |
| `/login`, auth, legal, other routes | No | Outside Phase 1-2 scope |

Trailing slashes are normalized. Nested paths below a product detail route, such as `/shop/[id]/reviews`, are hidden. See `src/components/ai/ai-chat-routes.ts`.

## Component Map

| File | Responsibility |
|---|---|
| `src/components/ai/ai-chat-widget.tsx` | Floating launcher, responsive dialog, request lifecycle, history assembly, cart snapshot, proposal confirmation, retry, abort on unmount |
| `src/components/ai/ai-chat-message.tsx` | User/assistant bubbles, welcome state, suggested prompts, loading indicator, error and retry UI, proposal and conflict wiring |
| `src/components/ai/ai-cart-proposal.tsx` | Proposal card with item-level quantity changes, Confirm/Cancel controls, applied/dismissed/stale status, conflict chip |
| `src/components/ai/ai-product-card.tsx` | Grounded product card with BDT price, server stock, approved/fallback image, product link |
| `src/components/ai/ai-chat-routes.ts` | Route visibility predicate |
| `src/components/ai/ai-chat-types.ts` | UI-only message, proposal status, and retry types, suggested prompts |
| `src/lib/ai-chat.ts` | Request validation, history and cart normalization, fetch, timeout, response validation, cart fingerprint, error mapping, BDT formatting |
| `src/lib/cart-store.ts` | Persisted Zustand cart, including the absolute, idempotent `setItem()` used by confirmed proposals |
| `src/app/(public)/layout.tsx` | Mounts `<AiChatWidget />` after the footer |

## Request Contract

The frontend sends only the fields accepted by the backend:

```json
{
  "message": "Add two Napa One",
  "history": [
    { "role": "user", "content": "Show me pain and fever options." },
    { "role": "assistant", "content": "Here are catalog matches." }
  ],
  "cart": {
    "items": [
      { "medicineId": "cm...", "quantity": 1 }
    ]
  }
}
```

Rules enforced in `src/lib/ai-chat.ts`:

- `message` is trimmed and must contain 1-1000 characters.
- History is limited to the newest 6 messages.
- History roles are limited to `user` and `assistant`.
- Each history message is trimmed, emptied messages are removed, and content is capped at 1000 characters.
- `cart` is optional. When present, it contains at most 20 unique medicine lines, with integer quantities from 1 to 10,000.
- The widget sends the current cart snapshot on every request, including an empty cart, so the assistant can propose additions to an empty cart.
- If the local cart has more than 20 lines, the widget omits `cart` instead of sending a truncated snapshot. The request then becomes catalog-only until the cart fits.
- `normalizeAiChatCart` drops malformed lines, deduplicates by medicine ID with last-write-wins, and rejects more than 20 valid unique lines.
- The request never includes local prices, stock, seller IDs, availability, or product names. The backend resolves all of those from PostgreSQL.
- The request is sent with `credentials: "include"` so the existing session cookies continue to work.
- No API keys, provider model names, or Gemini URLs are included in the request.
- The client aborts after 20 seconds (`AI_CHAT_TIMEOUT_MS`), and also aborts on widget unmount.
- Runtime response validation uses Zod. Malformed success envelopes are treated as an invalid response instead of rendering untrusted data.
- No conversation data is written to `localStorage` or `sessionStorage`.

An HTTP 400 response surfaces the backend message when one is present. This covers cases such as a local cart line whose product has been removed from the catalog.

## Response Contract

The backend may return a cart result alongside the normal answer:

```json
{
  "answer": "I can make that cart change.",
  "products": [],
  "cart": {
    "proposal": {
      "id": "f0d1...",
      "action": "SET_QTY",
      "items": [
        {
          "medicineId": "cm...",
          "name": "Napa One",
          "slug": "napa-one",
          "manufacturer": "Beximco",
          "price": 2.51,
          "stock": 12,
          "imageUrl": null,
          "seller": { "id": "cm...", "name": "MediStore", "image": null },
          "previousQuantity": 1,
          "quantity": 3
        }
      ],
      "cartFingerprint": "cm...:1"
    }
  },
  "meta": { "model": "gemini-3.1-flash-lite", "toolCalls": 1, "fallback": false }
}
```

`cart` contains exactly one of these variants:

| Variant | Shape | UI behavior |
|---|---|---|
| `proposal` | `{ id, action: "SET_QTY" \| "CLEAR", items, cartFingerprint }` | Renders a pending proposal card with Confirm and Cancel |
| `conflict` | `{ code, message }` | Renders the server message and a labeled warning chip |
| `summary` | `{ items, totalItems, singleSeller }` | Renders the answer only; no mutation control |

Proposal details:

- `action: "SET_QTY"` items contain the final desired `quantity`. Quantity `0` removes that line.
- `action: "CLEAR"` lists the current cart lines with `quantity: 0`; the UI applies it with `cartStore.clear()`.
- `previousQuantity` is display context only. The UI always applies the final `quantity`, never an increment.
- `cartFingerprint` is built from the request snapshot as sorted `medicineId:quantity` pairs joined with `|`, or the literal `empty`. Sorting uses code-unit order so the browser and Node produce identical strings.
- Cart results use deterministic server-built answer text and an empty `products` array. `meta.fallback` is `false` for proposals, conflicts, and summaries.

## Confirmation Flow

1. Send the current cart snapshot and render the response as an assistant message.
2. A proposal starts in `pending`. The cart is not changed at this point.
3. Confirm recomputes the local fingerprint and compares it with `proposal.cartFingerprint`.
4. A mismatch marks the proposal `stale`, shows "Your cart changed since this was proposed. Nothing was applied. Ask again for an updated change.", and performs no mutation.
5. A match claims the proposal ID in a session ref before mutating, which blocks a duplicate confirmation.
6. `CLEAR` clears the cart. `SET_QTY` applies each line through `setItem(item, quantity)`, an absolute idempotent operation. A missing line is added; an existing line only has its `qty` changed.
7. The proposal becomes `applied` and shows "Cart updated." Any other pending proposal is marked `stale` because it was built from the previous cart.
8. Cancel marks the proposal `dismissed`, shows "Proposal dismissed. Nothing was changed.", and performs no mutation.

The cart store remains untrusted purchase intent. Checkout still recalculates prices, stock, seller rules, and totals on the backend.

## Rendering Rules

- Assistant content is rendered as plain text in a `whitespace-pre-wrap` paragraph. There is no `dangerouslySetInnerHTML` and no Markdown execution.
- A response with `meta.fallback === true` is a normal catalog-only answer. It renders the answer plus a small "Catalog-only answer" marker, not a generic error.
- Product cards use only server-provided fields:
  - `name`
  - `manufacturer` when present; otherwise "Manufacturer unavailable"
  - `price` formatted as BDT
  - `stock`, `inStock`, and `stockStatus` for the stock label
  - `imageUrl` when present, otherwise the shared `PRODUCT_IMAGE_MAP`, otherwise a neutral pill icon
  - `category.name`
  - Link to `/shop/${product.id}`
- Product cards do not include Add to Cart, Buy Now, quantity, or checkout controls.
- Proposal cards show the server-verified product name, seller name, unit price, previous quantity, and final quantity. They do not collect a quantity from the user.
- Conflict chips use these labels:

| Code | Label |
|---|---|
| `CART_UNAVAILABLE` | Cart unavailable |
| `CART_LIMIT` | Cart limit reached |
| `INVALID_ACTION` | Change not valid |
| `INVALID_ITEM` | Product not verified |
| `PRODUCT_UNAVAILABLE` | Product unavailable |
| `INSUFFICIENT_STOCK` | Not enough stock |
| `SINGLE_SELLER` | One seller per order |
| `NO_CHANGE` | No change needed |

- The single-seller conflict is shown as a plain message: "For now, one order can contain medicines from only one seller. Remove items from the other seller and try again."
- The UI never invents strength, dosage, clinical equivalence, expiry, price, stock, or seller data. It also never substitutes another product for a missing result.

## Loading, Errors, and Retry

- Only one request may be in flight. The send button is disabled while pending, and a `pendingRef` guard blocks Enter and suggestion submissions.
- Stale responses are ignored through a request-id check.
- A failed request creates a retryable error bubble. Retry reuses the original message and the history captured at send time, removes the error bubble on success, and sends a fresh cart snapshot.
- Error mapping is centralized in `getAiChatErrorMessage`:

| Condition | User-facing behavior |
|---|---|
| 400 | Show the backend message when present; otherwise ask the user to check the message |
| 404 | Assistant unavailable |
| 429 | Ask the user to wait before retrying |
| 500 / other 5xx | Generic retryable error |
| 502 / 503 | Temporarily unavailable |
| 504 | Took too long |
| Network failure | Connection message |
| Client timeout / abort | Timeout message; unmount aborts are silent |
| Invalid response | Unexpected-response message |

## Accessibility and Responsive Behavior

- Launcher has an explicit accessible name.
- Radix Dialog provides focus trapping, Escape-to-close, and a labelled/described dialog.
- The close button, send button, Confirm, and Cancel have accessible names.
- The textarea has a visible label via `aria-label`.
- Proposal and conflict statuses are announced with `role="status"`.
- The conversation container is an `aria-live="polite"` region and reports `aria-busy` while loading.
- The loading indicator is announced as "Assistant is checking the catalog".
- Mobile uses a full-screen dialog with safe-area padding. At `sm` and above it becomes a floating card above the launcher.
- Surfaces use semantic tokens and dark variants; both light and dark themes are supported.

## Tests

The frontend uses Vitest 5, jsdom, React Testing Library, `jest-dom`, and `user-event`.

| Suite | Coverage |
|---|---|
| `src/lib/ai-chat.test.ts` | Request body with and without cart, trim, history cap/truncation, cart normalization and fingerprint, proposal/conflict/summary parsing, malformed cart responses, BDT formatting, HTTP error mappings including backend 400 messages, malformed envelope, network error, timeout, external abort |
| `src/lib/cart-store.test.ts` | Absolute `setItem`, idempotency, add missing line, remove at zero, ignored non-finite quantities |
| `src/components/ai/ai-chat-routes.test.ts` | Visible and hidden route matrix |
| `src/components/ai/ai-chat-widget.test.tsx` | Open/close, keyboard access, submit, loading, product cards, BDT, history, retry, messaging, fallback marker, plain-text safety, duplicate submissions, empty input, cart snapshot, oversized-cart omission, confirm add/set/remove/clear, cancel, stale proposal, duplicate confirmation, conflict display, no mutation before approval |
| `src/components/ai/ai-product-card.test.tsx` | Server fields, BDT, stock states, image fallbacks, product link, absence of cart controls |

Current result: 5 test files and 96 tests passing.

Dependency note: `better-auth@1.6.1` declares an unmet peer of `vitest@^2 || ^3 || ^4` while the project uses Vitest 5. This is a known non-blocking peer warning with no effect on test execution or runtime behavior.

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Local Integration Smoke Test

The backend remains disabled by default (`AI_ENABLED=false`). For a temporary local check, start the backend on a separate port with the model override and point the frontend proxy at it:

```powershell
# backend
$env:PORT="5001"
$env:AI_ENABLED="true"
$env:GEMINI_MODEL="gemini-3.5-flash-lite"
pnpm dev

# frontend
$env:LOCAL_BACKEND_URL="http://localhost:5001"
pnpm dev
```

Then send a request through the frontend proxy:

```bash
curl -X POST http://localhost:3000/api/v1/ai/shopping/chat \
  -H "content-type: application/json" \
  -d '{"message":"Do you have Napa One?","history":[]}'
```

For a cart proposal check, include the current snapshot:

```bash
curl -X POST http://localhost:3000/api/v1/ai/shopping/chat \
  -H "content-type: application/json" \
  -d '{"message":"Add two Napa One","history":[],"cart":{"items":[]}}'
```

Restore `AI_ENABLED=false` when the smoke test ends. The temporary model override is not a production setting.

Verified on 20 October 2026 for Phase 1: the proxy returned a grounded `Napa One` answer and product card with `meta.fallback=false` and `meta.model=gemini-3.5-flash-lite`. Server-rendered HTML included the launcher on `/`, `/shop`, and `/shop/[id]` and omitted it on `/cart`, `/checkout`, and `/account`. Phase 2 cart proposals are covered by the automated backend and frontend suites; no live provider smoke test was run for the cart flow. The temporary servers were stopped, and the backend `.env` remains at `AI_ENABLED=false` with `GEMINI_MODEL=gemini-3.1-flash-lite`.

## Deployment Gate

Do not deploy the storefront widget while the backend has `AI_ENABLED=false`. The chat route returns 404 in that state, and the UI renders its unavailable message. Enable the backend only after review and a separate cost/safety decision. The `gemini-3.5-flash-lite` override is local-only; the production default remains `gemini-3.1-flash-lite`.

Cart proposals do not bypass checkout validation. Enabling the assistant does not enable payment automation, order placement, or inventory changes.

## Out of Scope for Phases 1-2

- Streaming responses
- Markdown rendering
- Automatic cart mutation without confirmation
- Order placement, checkout mutation, or payment actions
- Persisting cart data to the database from the assistant
- Conversation persistence across sessions or tabs
- Frontend provider configuration
- Admin analytics or evaluation UI
- Phase 3 inventory AI, batch-expiry actions, or payment automation
