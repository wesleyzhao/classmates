// Normalize email callbacks without consuming credentials on GET or assuming a browser session.
/** Parse local/Resend fragments and Descope's query callback into the same confirmation payload. */
export function loginLink(href) {
  const url = new URL(href),
    fragment = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.get("provider") === "descope") {
    const token = url.searchParams.get("state"),
      proof = url.searchParams.get("t");
    return token ? { token, proof } : null;
  }
  const token = fragment.get("token");
  return token ? { token, proof: fragment.get("proof") } : null;
}
