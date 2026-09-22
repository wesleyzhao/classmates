// Managed email proof uses Descope's HTTPS API; app sessions and game accounts remain provider-independent.
import { PlatformError } from "../../public/shared/errors.js";
import { invitePath } from "../../public/gsb/invite-path.js";
/** Call only the fixed provider origin; never accept an endpoint or identity from a browser. */
async function call(path, body, fetcher = fetch) {
  if (!process.env.DESCOPE_PROJECT_ID)
    throw new PlatformError(
      503,
      "email_pending",
      "Login email is not configured yet.",
    );
  let response;
  try {
    response = await fetcher(
      `https://api.descope.com/v1/auth/magiclink/${path}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${process.env.DESCOPE_PROJECT_ID}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    throw new PlatformError(
      503,
      "email_unavailable",
      "The email service is unavailable. Please try again shortly.",
    );
  }
  if (!response.ok) {
    // Record a provider error code for operators, never a token, recipient or provider body.
    const error = await response.json().catch(() => ({}));
    console.warn(
      "[gsb] email provider rejected request",
      response.status,
      String(error.errorCode ?? "unknown").slice(0, 80),
    );
    throw new PlatformError(
      path === "verify" ? 400 : 503,
      "email_link",
      path === "verify"
        ? "This email link has expired or was already used. Request a new one."
        : "We could not send your link. Please try again shortly.",
    );
  }
  return response.json();
}
/** Send to the entered address, preserving the app's independent origin-bound challenge. */
export async function sendDescopeLink(email, url, fetcher = fetch) {
  const target = new URL(url);
  const fragment = new URLSearchParams(target.hash.slice(1));
  const state = fragment.get("token"), back = invitePath(fragment.get("returnTo"));
  target.hash = "";
  target.search = new URLSearchParams({
    provider: "descope",
    state,
  }).toString();
  if (back) target.searchParams.set("returnTo", back);
  await call(
    "signup-in/email",
    { loginId: email, redirectUrl: target.href },
    fetcher,
  );
}
/** Require provider-verified email ownership of precisely the app challenge's intended recipient. */
export async function verifyDescopeLink(proof, expectedEmail, fetcher = fetch) {
  if (typeof proof !== "string" || !proof || proof.length > 2048)
    throw new PlatformError(
      400,
      "email_link",
      "Open the complete sign-in link from your email.",
    );
  const data = await call("verify", { token: proof }, fetcher);
  if (
    data.user?.verifiedEmail !== true ||
    data.user?.test === true ||
    String(data.user?.email ?? "").toLowerCase() !== expectedEmail
  )
    throw new PlatformError(
      403,
      "email_link",
      "This link does not verify the requested email address.",
    );
}
