const fileUpload = require("express-fileupload");

const { BadRequestError } = require("../errors/BaseError");
const {
  uploadBackstopBytes,
} = require("../commons/services/media/media-config");

// The only routes that take files: the upload of the tenant and of the
// instance media library (`POST /api/v2/:tenant/media`, where `instance` is
// the instance library). Every other route turns multipart bodies away before
// a single byte is parsed.
const UPLOAD_ROUTE = /^\/api\/v2\/[^/]+\/media\/?$/;

/**
 * Whether a request is addressed to one of the upload routes.
 *
 * @param {import("express").Request} req
 * @returns {boolean}
 */
function isUploadRoute(req) {
  return req.method === "POST" && UPLOAD_ROUTE.test(req.path);
}

/**
 * Global guard: rejects multipart bodies on every route that is not an upload
 * route, so files are never parsed outside of them.
 */
function rejectMultipart(req, res, next) {
  if (req.is("multipart/form-data") && !isUploadRoute(req)) {
    return next(new BadRequestError("multipart_not_supported"));
  }

  return next();
}

/**
 * Parses a multipart body with exactly one file. Mounted on the upload routes
 * after the authorization, so nothing is parsed for a caller that may not
 * upload.
 *
 * Busboy drops files beyond `limits.files` silently, so the limit is one above
 * what is allowed: a second file is still seen and turns the request away.
 *
 * @returns {import("express").RequestHandler[]}
 */
function acceptSingleFile() {
  return [
    fileUpload({
      // Deliberately above the largest media limit: the media layer answers
      // with its own 400, this only stops requests no upload would accept.
      limits: { fileSize: uploadBackstopBytes(), files: 2 },
      abortOnLimit: true,
      responseOnLimit: "File too large.",
    }),
    (req, res, next) => {
      const files = Object.values(req.files || {}).flat();

      if (files.length > 1) {
        return next(new BadRequestError("multiple_files_not_supported"));
      }

      return next();
    },
  ];
}

module.exports = { acceptSingleFile, isUploadRoute, rejectMultipart };
