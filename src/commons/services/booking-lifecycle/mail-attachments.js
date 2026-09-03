/**
 * The `mailAttach` documents of a booking as the mail stack takes them: a
 * helper of the notify steps of the booking lifecycle (spec part 2, section
 * 10), which add them to the documents a transition issued. Media
 * references are read through the media service, everything else over
 * HTTP; an attachment that cannot be read or fails the safety check is
 * left out and logged. Lived in `BookingService` until ticket 4.
 */

const axios = require("axios");
const mime = require("mime-types");
const bunyan = require("bunyan");
const MediaManager = require("../../data-managers/media-manager");
const MediaService = require("../media/media-service");
const { toMediaReference } = require("../media/media-reference");

const logger = bunyan.createLogger({
  name: "mail-attachments.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Loads a `mailAttach` attachment that points at a medium. The bytes come
 * straight out of the media library instead of through the platform's own
 * public URL, which is why `mailAttach` works for intern media at all: an
 * HTTP self-call would have to authenticate as somebody.
 *
 * @param {Object} att - The booking attachment.
 * @param {string} tenantId - Tenant of the booking.
 * @returns {Promise<Object|null>} Nodemailer attachment, null when unreadable.
 */
async function loadMediaMailAttachment(att, tenantId) {
  const mediaId = att.reference.mediaId;
  const media = await MediaManager.getMedia(mediaId, tenantId);

  if (!media) {
    logger.error(`Attachment medium ${mediaId} not found in ${tenantId}`);
    return null;
  }

  const content = await MediaService.getBuffer(media);
  const filename = extractFilename(media.originalFileName, att.title);

  return {
    filename,
    content,
    contentType: determineContentType(media.mimeType, filename),
  };
}

/**
 * Downloads an attachment that is not held by the media library — an external
 * reference or a legacy raw URL.
 *
 * @param {Object} att - The booking attachment.
 * @param {string} url - The address to fetch.
 * @returns {Promise<Object>} Nodemailer attachment.
 */
async function downloadMailAttachment(att, url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 25 * 1024 * 1024,
  });

  const filename = extractFilename(url, att.title);

  return {
    filename,
    content: Buffer.from(response.data),
    contentType: determineContentType(
      response.headers["content-type"],
      filename,
    ),
  };
}

/**
 * Prepares the attachments of a booking for email sending. Media references
 * are read through the media service, everything else over HTTP.
 *
 * @param {Array} attachments - Array of attachment objects from booking
 * @param {string} tenantId - Tenant the booking belongs to
 * @returns {Promise<Array>} - Array of attachments in nodemailer format
 */
async function prepareMailAttachments(attachments, tenantId) {
  if (!attachments || !Array.isArray(attachments)) {
    return [];
  }

  const uniqueAttachments = [];
  const seen = new Set();

  for (const att of attachments) {
    if (att.mailAttach !== true) {
      continue;
    }

    const reference = toMediaReference(att.reference ?? att.url);
    if (!reference) {
      continue;
    }

    const key = reference.mediaId
      ? `media:${reference.mediaId}`
      : `url:${reference.url}`;

    if (!seen.has(key)) {
      uniqueAttachments.push({ att, reference });
      seen.add(key);
    }
  }

  if (uniqueAttachments.length === 0) {
    return [];
  }

  const downloadedAttachments = await Promise.all(
    uniqueAttachments.map(async ({ att, reference }) => {
      try {
        const attachment = reference.mediaId
          ? await loadMediaMailAttachment({ ...att, reference }, tenantId)
          : await downloadMailAttachment(att, reference.url);

        if (!attachment) {
          return null;
        }

        logger.debug(
          `Prepared attachment: ${attachment.filename} (${attachment.contentType}, ${attachment.content.length} bytes)`,
        );

        if (!isAttachmentSafe(attachment)) {
          logger.warn(
            `Attachment ${attachment.filename} failed safety validation, skipping`,
          );
          return null;
        }

        return attachment;
      } catch (err) {
        logger.error(
          `Failed to prepare attachment ${reference.mediaId || reference.url}: ${err.message}`,
        );
        return null;
      }
    }),
  );

  return downloadedAttachments.filter((att) => att !== null);
}

/**
 * Extracts a clean filename from URL or generates one from title
 * @param {string} url - The attachment URL
 * @param {string} title - The attachment title
 * @returns {string} - Clean filename
 */
function extractFilename(url, title) {
  try {
    let urlFilename = "";
    let extension = ".pdf";

    try {
      const urlObj = new URL(url);

      const nameParam = urlObj.searchParams.get("name");
      if (nameParam) {
        const pathParts = nameParam.split("/");
        urlFilename = pathParts[pathParts.length - 1];
      } else {
        const pathParts = urlObj.pathname.split("/");
        urlFilename = decodeURIComponent(pathParts[pathParts.length - 1]);
      }

      if (urlFilename && urlFilename.includes(".")) {
        extension = "." + urlFilename.split(".").pop().toLowerCase();
      }
    } catch (urlError) {
      const urlParts = url.split("?")[0].split("/");
      urlFilename = decodeURIComponent(urlParts[urlParts.length - 1]);
      if (urlFilename.includes(".")) {
        extension = "." + urlFilename.split(".").pop().toLowerCase();
      }
    }

    if (title && title.trim().length > 0) {
      let filename = sanitizeFilename(title);

      if (filename.includes(".")) {
        filename = filename.substring(0, filename.lastIndexOf("."));
      }

      return filename + extension;
    }

    if (urlFilename && urlFilename.length >= 3 && urlFilename !== "get") {
      return urlFilename;
    }

    return "Anhang" + extension;
  } catch (err) {
    return "Anhang.pdf";
  }
}

/**
 * Sanitizes a string to be used as filename
 * @param {string} str - Input string
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(str) {
  if (!str) return "attachment";

  return str
    .replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 200);
}

/**
 * Determines content type from header or filename extension
 * @param {string} headerContentType - Content-Type from HTTP response
 * @param {string} filename - The filename
 * @returns {string} - MIME type
 */
function determineContentType(headerContentType, filename) {
  if (headerContentType && headerContentType !== "application/octet-stream") {
    return headerContentType.split(";")[0].trim();
  }

  const mimeType = mime.lookup(filename);
  if (mimeType) {
    return mimeType;
  }

  const extension = filename.split(".").pop().toLowerCase();
  return getMimeTypeFromExtension(extension);
}

/**
 * Manual MIME type mapping for common file extensions
 * @param {string} extension - File extension without dot
 * @returns {string} - MIME type
 */
function getMimeTypeFromExtension(extension) {
  const mimeTypes = {
    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    rtf: "application/rtf",
    txt: "text/plain",
    csv: "text/csv",

    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp",
    tiff: "image/tiff",
    tif: "image/tiff",
    ico: "image/x-icon",

    // Archives
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",

    // Media
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    wmv: "video/x-ms-wmv",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",

    // Web
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    xml: "application/xml",

    // Other
    ics: "text/calendar",
    vcf: "text/vcard",
    eml: "message/rfc822",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

/**
 * Validates if attachment is safe to send
 * @param {Object} attachment - Attachment object
 * @returns {boolean} - Whether attachment is safe
 */
function isAttachmentSafe(attachment) {
  const dangerousExtensions = [
    "exe",
    "bat",
    "cmd",
    "com",
    "pif",
    "scr",
    "vbs",
    "js",
    "jar",
  ];

  const maxSize = 25 * 1024 * 1024;

  if (attachment.content.byteLength > maxSize) {
    logger.warn(
      `Attachment ${attachment.filename} exceeds size limit (${attachment.content.byteLength} bytes)`,
    );
    return false;
  }

  const extension = attachment.filename.split(".").pop().toLowerCase();
  if (dangerousExtensions.includes(extension)) {
    logger.warn(
      `Attachment ${attachment.filename} has dangerous extension: ${extension}`,
    );
    return false;
  }

  return true;
}

module.exports = { prepareMailAttachments };
