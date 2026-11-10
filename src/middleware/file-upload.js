const fileUpload = require("express-fileupload");

const { BadRequestError } = require("../errors/BaseError");
const {
  uploadBackstopBytes,
} = require("../commons/services/media/media-config");

// The only routes that take files: the upload of the tenant and of the
// instance media library (`POST /api/v2/:tenant/media`, where `instance` is
// the instance library), the customer uploads of a booking (`POST
// /api/v2/:tenant/bookings/:id/customer-uploads/:fieldId`, a replacement
// with `PUT .../:fieldId/:mediaId`). Every other
// route turns multipart bodies away before a single byte is parsed.
const UPLOAD_ROUTES = [
  { method: "POST", path: /^\/api\/v2\/[^/]+\/media\/?$/ },
  {
    method: "POST",
    path: /^\/api\/v2\/[^/]+\/bookings\/[^/]+\/customer-uploads\/[^/]+\/?$/,
  },
  {
    method: "PUT",
    path: /^\/api\/v2\/[^/]+\/bookings\/[^/]+\/customer-uploads\/[^/]+\/[^/]+\/?$/,
  },
];

/**
 * Whether a request is addressed to one of the upload routes.
 *
 * @param {import("express").Request} req
 * @returns {boolean}
 */
function isUploadRoute(req) {
  return UPLOAD_ROUTES.some(
    (route) => route.method === req.method && route.path.test(req.path),
  );
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
 * @param {Object} [options]
 * @param {() => number} [options.backstopBytes] The size no upload of the
 *   route is ever accepted at; by default the media library's backstop
 * @param {boolean} [options.truncate] Whether a file above the backstop is
 *   handed on cut off (`file.truncated`) for the route to answer with its
 *   own reason, instead of a plain 413 "File too large."
 * @returns {import("express").RequestHandler[]}
 */
function acceptSingleFile({
  backstopBytes = uploadBackstopBytes,
  truncate = false,
} = {}) {
  return [
    fileUpload({
      // Deliberately above the largest limit of the route: the service
      // answers with its own 400, this only stops requests no upload would
      // accept.
      limits: { fileSize: backstopBytes(), files: 2 },
      abortOnLimit: !truncate,
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
