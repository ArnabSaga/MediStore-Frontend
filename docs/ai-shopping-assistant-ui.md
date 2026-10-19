# AI Shopping Assistant UI

## Scope

Phase 1 adds a floating, catalog-grounded shopping assistant to the MediStore storefront. It is a presentation and transport layer only. Product facts, stock, pricing, and assistant text come from the existing backend endpoint.

- Backend endpoint: `POST /api/v1/ai/shopping/chat`
- Browser transport: the existing same-origin Next.js proxy at `src/app/api/v1/[...path]/route.ts`
- Provider access: backend only. The frontend never calls Gemini directly and never handles provider credentials.
- Shopping behavior: the assistant links to product pages but does not add items to the cart or start checkout.

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
| `/login`, auth, legal, other routes | No | Outside Phase 1 scope |

Trailing slashes are normalized. Nested paths below a product detail route, such as `/shop/[id]/reviews`, are hidden. See `src/components/ai/ai-chat-routes.ts`.

## Component Map

| File | Responsibility |
|---|---|
| `src/components/ai/ai-chat-widget.tsx` | Floating launcher, responsive dialog, request lifecycle, history assembly, retry, abort on unmount |
| `src/components/ai/ai-chat-message.tsx` | User/assistant bubbles, welcome state, suggested prompts, loading indicator, error and retry UI |
| `src/components/ai/ai-product-card.tsx` | Grounded product card with BDT price, server stock, approved/fallback image, product link |
| `src/components/ai/ai-chat-routes.ts` | Route visibility predicate |
| `src/components/ai/ai-chat-types.ts` | UI-only message and retry types, suggested prompts |
| `src/lib/ai-chat.ts` | Request validation, history normalization, fetch, timeout, response validation, error mapping, BDT formatting |
| `src/app/(public)/layout.tsx` | Mounts `<AiChatWidget />` after the footer |

## Request Contract

The frontend sends only the fields accepted by the backend:

```json
{
  "message": "Do you have Napa One?",
  "history": [
    { "role": "user", "content": "Show me pain and fever options." },
    { "role": "assistant", "content": "Here are catalog matches." }
  ]
}
```

Rules enforced in `src/lib/ai-chat.ts`:

- `message` is trimmed and must contain 1–1000 characters.
- History is limited to the newest 6 messages.
- History roles are limited to `user` and `assistant`.
- Each history message is trimmed, emptied messages are removed, and content is capped at 1000 characters.
- The request is sent with `credentials: "include"` so the existing session cookies continue to work.
- No API keys, provider model names, or Gemini URLs are included in the request.
- The client aborts after 20 seconds (`AI_CHAT_TIMEOUT_MS`), and also aborts on widget unmount.
- Runtime response validation uses Zod. Malformed success envelopes are treated as an invalid response instead of rendering untrusted data.
- No conversation data is written to `localStorage` or `sessionStorage`.

## Rendering Rules

- Assistant content is rendered as plain text in a `whitespace-pre-wrap` paragraph. There is no `dangerouslySetInnerHTML` and no Markdown execution.
- A response with `meta.fallback === true` is a normal catalog-only answer. It renders the answer plus a small “Catalog-only answer” marker, not a generic error.
- Product cards use only server-provided fields:
  - `name`
  - `manufacturer` when present; otherwise “Manufacturer unavailable”
  - `price` formatted as BDT
  - `stock`, `inStock`, and `stockStatus` for the stock label
  - `imageUrl` when present, otherwise the shared `PRODUCT_IMAGE_MAP`, otherwise a neutral pill icon
  - `category.name`
  - Link to `/shop/${product.id}`
- Product cards do not include Add to Cart, Buy Now, quantity, or checkout controls.
- The UI never invents strength, dosage, clinical equivalence, expiry, price, or stock. It also never substitutes another product for a missing result.

## Loading, Errors, and Retry

- Only one request may be in flight. The send button is disabled while pending, and a `pendingRef` guard blocks Enter and suggestion submissions.
- Stale responses are ignored through a request-id check.
- A failed request creates a retryable error bubble. Retry reuses the original message and the history captured at send time, and removes the error bubble on success.
- Error mapping is centralized in `getAiChatErrorMessage`:

| Condition | User-facing behavior |
|---|---|
| 400 | Ask the user to check the message |
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
- The close button and send button have accessible names.
- The textarea has a visible label via `aria-label`.
- The conversation container is an `aria-live="polite"` region and reports `aria-busy` while loading.
- The loading indicator is announced as “Assistant is checking the catalog”.
- Mobile uses a full-screen dialog with safe-area padding. At `sm` and above it becomes a floating card above the launcher.
- Surfaces use semantic tokens and dark variants; both light and dark themes are supported.

## Tests

The frontend uses Vitest 5, jsdom, React Testing Library, `jest-dom`, and `user-event`.

| Suite | Coverage |
|---|---|
| `src/lib/ai-chat.test.ts` | Request body, trim, history cap/truncation, BDT formatting, all HTTP error mappings, malformed envelope, network error, timeout, external abort |
| `src/components/ai/ai-chat-routes.test.ts` | Visible and hidden route matrix |
| `src/components/ai/ai-chat-widget.test.tsx` | Open/close, keyboard access, submit, loading, product cards, BDT, no cart controls, history, retry, timeout/network/rate-limit messaging, fallback marker, plain-text HTML safety, duplicate prevention, empty input |
| `src/components/ai/ai-product-card.test.tsx` | Server fields, BDT, stock states, image fallbacks, product link, absence of cart controls |

Current result: 4 test files and 63 tests passing.

Run:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

## Local Integration Smoke Test

The backend remains disabled by default (`AI_ENABLED=false`). For a temporary local check, start the backend on a separate port with the Phase 1 model override and point the frontend proxy at it:

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

Restore `AI_ENABLED=false` when the smoke test ends. The temporary model override is not a production setting.

Verified on 20 October 2026: the proxy returned a grounded `Napa One` answer and product card with `meta.fallback=false` and `meta.model=gemini-3.5-flash-lite`. Server-rendered HTML included the launcher on `/`, `/shop`, and `/shop/[id]` and omitted it on `/cart`, `/checkout`, and `/account`. The temporary servers were stopped, and the backend `.env` remains at `AI_ENABLED=false` with `GEMINI_MODEL=gemini-3.1-flash-lite`.

## Deployment Gate

Do not deploy the storefront widget while the backend has `AI_ENABLED=false`. The chat route returns 404 in that state, and the UI renders its unavailable message. Enable the backend only after the Phase 1 review and a separate cost/safety decision. The `gemini-3.5-flash-lite` override is local-only; the production default remains `gemini-3.1-flash-lite`.

## Out of Scope for Phase 1

- Streaming responses
- Markdown rendering
- Cart or checkout actions from the assistant
- Conversation persistence across sessions or tabs
- Frontend provider configuration
- Admin analytics or evaluation UI
