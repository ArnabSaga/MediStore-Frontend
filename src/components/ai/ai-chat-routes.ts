const AI_CHAT_VISIBLE_ROUTES = new Set(["/", "/shop"]);

export function shouldShowAiChat(
  pathname: string | null | undefined
): boolean {
  if (!pathname) {
    return false;
  }

  const normalized =
    pathname === "/" ? pathname : pathname.replace(/\/+$/, "");

  if (AI_CHAT_VISIBLE_ROUTES.has(normalized)) {
    return true;
  }

  return /^\/shop\/[^/]+$/.test(normalized);
}
