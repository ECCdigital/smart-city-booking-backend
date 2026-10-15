/**
 * A page of the client's that a mail of the public authentication routes
 * links with its token: the reset page of forgot password (`resetUrl`), the
 * verify page of signup and verification resend (`verifyUrl`) and the link
 * page of the card signup (`linkUrl`). Whoever opens the link hands the token
 * to that page, so the backend takes the client's page only on the instance's
 * own origins - those of `FRONTEND_URL`, `STORE_FRONT_URL` and `BACKEND_URL`
 * (ECCdigital/tickets#320, #480). Path and
 * language prefix stay as the client named them; a page anywhere else is
 * dropped silently, and the mail links the backend's default instead, so the
 * answer does not change (ECCdigital/tickets#259).
 */

function parseHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {*} url the page the client named
 * @returns {string|null} the page as given, or `null` when it is not one of
 *   the instance's own
 */
function normalizeClientPage(url) {
  if (typeof url !== "string") {
    return null;
  }
  const page = url.trim();
  const parsed = parseHttpUrl(page);
  if (!parsed) {
    return null;
  }
  const own = [
    process.env.FRONTEND_URL,
    process.env.STORE_FRONT_URL,
    process.env.BACKEND_URL,
  ]
    .map(parseHttpUrl)
    .filter(Boolean)
    .map((origin) => origin.origin);
  return own.includes(parsed.origin) ? page : null;
}

module.exports = { normalizeClientPage, parseHttpUrl };
