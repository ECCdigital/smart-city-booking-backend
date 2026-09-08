const bunyan = require("bunyan");
const MediaManager = require("../../data-managers/media-manager");
const { MEDIA_KIND } = require("../../schemas/mediaSchema");

const logger = bunyan.createLogger({
  name: "mail-media.js",
  level: process.env.LOG_LEVEL,
});

/** The preset mails are sent at — `sm` covers mail widths (§4.5). */
const MAIL_IMAGE_PRESET = "sm";

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTRIBUTE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ALT_ATTRIBUTE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const MEDIA_FILE_URL =
  /^(?:https?:\/\/[^/]+)?\/api\/v2\/([^/?#]+)\/media\/([^/?#]+)\/file(?:\?.*)?$/;

/**
 * Reads the value of an attribute out of a tag.
 *
 * @param {string} tag - The whole tag, angle brackets included.
 * @param {RegExp} pattern - Attribute pattern with two capture groups.
 * @returns {string|null} The value, or null when the attribute is absent.
 */
function attributeValue(tag, pattern) {
  const match = tag.match(pattern);

  if (!match) {
    return null;
  }

  return (match[1] ?? match[2] ?? "").replace(/&amp;/g, "&");
}

/**
 * The medium a mail image points at — but only within the tenant the mail
 * belongs to. A URL naming another tenant is left alone; a mail is no place to
 * resolve foreign media.
 *
 * @param {string|null} src - The `src` of the image.
 * @param {string} tenantId - Tenant the mail is sent for.
 * @returns {{mediaId: string}|null}
 */
function mediaTarget(src, tenantId) {
  const match = String(src || "").match(MEDIA_FILE_URL);

  if (!match || match[1] !== tenantId) {
    return null;
  }

  return { mediaId: match[2] };
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Mail-ready delivery of a medium, absolute because a mail client has no
 * origin to resolve a relative address against.
 *
 * @param {Object} media - The medium.
 * @param {boolean} withPreset - Whether to ask for the mail preset.
 * @returns {string}
 */
function mailMediaUrl(media, withPreset) {
  const base = (process.env.BACKEND_URL || "").replace(/\/+$/, "");
  const preset = withPreset ? `?size=${MAIL_IMAGE_PRESET}` : "";

  return `${base}/api/v2/${media.tenantId}/media/${media.id}/file${preset}`;
}

/**
 * Applies the mail rule of §4.8 to every image of a rendered mail: a public
 * image medium is embedded in mail size, an intern one is only linked —
 * embedding it would show a broken image to every recipient, because the mail
 * client fetches it anonymously and `intern` needs a membership.
 *
 * Images that are not media of this tenant stay exactly as the author wrote
 * them.
 *
 * @param {string} html - The rendered mail body.
 * @param {string|null} tenantId - Tenant the mail is sent for.
 * @returns {Promise<string>} The mail body with media images resolved.
 */
async function embedMediaImages(html, tenantId) {
  if (typeof html !== "string" || !html || !tenantId) {
    return html;
  }

  const tags = html.match(IMG_TAG);

  if (!tags) {
    return html;
  }

  const replacements = new Map();

  for (const tag of tags) {
    if (replacements.has(tag)) {
      continue;
    }

    const src = attributeValue(tag, SRC_ATTRIBUTE);
    const target = mediaTarget(src, tenantId);

    if (!target) {
      continue;
    }

    try {
      const media = await MediaManager.getMedia(target.mediaId, tenantId);

      if (!media) {
        continue;
      }

      const isEmbeddable =
        media.kind === MEDIA_KIND.IMAGE &&
        media.isPublic() &&
        !media.isBookingDocument();

      if (isEmbeddable) {
        replacements.set(
          tag,
          tag.replace(
            SRC_ATTRIBUTE,
            `src="${escapeHtmlAttribute(mailMediaUrl(media, true))}"`,
          ),
        );
        continue;
      }

      const label =
        attributeValue(tag, ALT_ATTRIBUTE) ||
        media.title ||
        media.originalFileName;

      replacements.set(
        tag,
        `<a href="${escapeHtmlAttribute(mailMediaUrl(media, false))}">${escapeHtmlAttribute(label)}</a>`,
      );
    } catch (err) {
      logger.warn(
        `Could not resolve media ${target.mediaId} for a mail of ${tenantId}: ${err.message}`,
      );
    }
  }

  let output = html;
  for (const [tag, replacement] of replacements) {
    output = output.split(tag).join(replacement);
  }

  return output;
}

module.exports = { MAIL_IMAGE_PRESET, embedMediaImages };
