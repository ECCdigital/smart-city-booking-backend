const fileUpload = require("express-fileupload");

const {
  BadRequestError,
  TooManyRequestsError,
} = require("../errors/BaseError");
const {
  uploadBackstopBytes,
} = require("../commons/services/media/media-config");
const {
  customerUploadLimits,
} = require("../commons/services/customer-upload/customer-upload-rules");
const RateLimiter = require("../commons/services/rate-limit/rate-limiter");
const limits = require("../commons/services/rate-limit/limits");

const MEGABYTE = 1024 * 1024;

// The only routes that take files: the upload of the tenant and of the
// instance media library (`POST /api/v2/:tenant/media`, where `instance` is
// the instance library), the customer uploads of a booking (`POST
// /api/v2/:tenant/bookings/:id/customer-uploads/:fieldId`, a replacement
// with `PUT .../:fieldId/:mediaId`, every proof of the booking at once
// with `POST .../customer-uploads`; for a guest the same below
// `customer-uploads-by-link`), and the checkout of a single booking
// with the customer uploads of its upload fields (`POST
// /api/v2/:tenant/checkout`, the legacy `POST /api/:tenant/checkout`) and
// of a group (`.../checkout/group`). Every other
// route turns multipart bodies away before a single byte is parsed.
const UPLOAD_ROUTES = [
  { method: "POST", path: /^\/api\/v2\/[^/]+\/checkout(\/group)?\/?$/ },
  { method: "POST", path: /^\/api\/[^/]+\/checkout(\/group)?\/?$/ },
  { method: "POST", path: /^\/api\/v2\/[^/]+\/media\/?$/ },
  {
    method: "POST",
    path: /^\/api\/v2\/[^/]+\/bookings\/[^/]+\/customer-uploads(-by-link)?(\/[^/]+)?\/?$/,
  },
  {
    method: "PUT",
    path: /^\/api\/v2\/[^/]+\/bookings\/[^/]+\/customer-uploads(-by-link)?\/[^/]+\/[^/]+\/?$/,
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

/** The form field of a multipart checkout that carries its JSON body. */
const CHECKOUT_BODY_FIELD = "checkout";
/**
 * The prefix of a file's form field: the id of its upload field follows,
 * at a group checkout the key the body names the file's targets by.
 */
const CHECKOUT_FILE_PREFIX = "customerUpload:";

/**
 * The checkout with the customer uploads of its upload fields "in the
 * checkout". A JSON checkout passes untouched. A
 * multipart one carries its body as JSON in the field `checkout` and each
 * file in a field `customerUpload:<fieldId>`, as many as the fields take.
 * The rate limit of customer uploads, per person and IP, counts before a
 * byte is parsed; the booking does not exist yet.
 *
 * Afterwards `req.body` is the checkout's body and `req.customerUploadFiles`
 * the files, each `{ fieldId, key, file }` - both the name after the
 * prefix: the upload field at a single checkout, the key of the file at a
 * group checkout. Busboy drops files beyond
 * `limits.files` silently, so the limit is one above what a booking takes:
 * the file too many is still seen and refused by the limit of the booking.
 * A file above the instance limit is handed on cut off (`file.truncated`)
 * for the service to answer with its own reason.
 *
 * @returns {import("express").RequestHandler[]}
 */
function acceptCheckoutFiles() {
  const instance = customerUploadLimits();
  const multipart = (req) => req.is("multipart/form-data");
  return [
    async (req, res, next) => {
      if (!multipart(req)) return next();
      try {
        const gate = await RateLimiter.consumeAll(
          limits.customerUploadLimits({
            userId: req.user?.id ?? null,
            ip: req.ip || req.socket?.remoteAddress || "unknown",
          }),
        );
        if (!gate.allowed) {
          return next(
            new TooManyRequestsError("customer_upload_rate_limited", {
              retryAfterSeconds: gate.retryAfterSeconds,
            }),
          );
        }
        return next();
      } catch (error) {
        return next(error);
      }
    },
    fileUpload({
      limits: {
        fileSize: (instance.maxFileSizeMb + 1) * MEGABYTE,
        files: instance.maxFilesPerBooking + 1,
      },
      abortOnLimit: false,
    }),
    (req, res, next) => {
      if (!multipart(req)) return next();

      let body;
      try {
        body = JSON.parse(req.body?.[CHECKOUT_BODY_FIELD] ?? "");
      } catch {
        return next(new BadRequestError("checkout_body_invalid"));
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return next(new BadRequestError("checkout_body_invalid"));
      }

      const files = [];
      for (const [name, value] of Object.entries(req.files || {})) {
        if (!name.startsWith(CHECKOUT_FILE_PREFIX)) {
          return next(new BadRequestError("checkout_file_field_invalid"));
        }
        const fieldId = name.slice(CHECKOUT_FILE_PREFIX.length);
        for (const file of [].concat(value)) {
          files.push({ fieldId, key: fieldId, file });
        }
      }

      req.body = body;
      req.customerUploadFiles = files;
      return next();
    },
  ];
}

/**
 * Every proof of a booking at once, from the page „Nachweise einreichen“:
 * each file in a field `customerUpload:<fieldId>`,
 * a replacement in `customerUpload:<fieldId>:<mediaId>`, as many as the
 * booking takes. Mounted after the booking and the rate limit were
 * admitted. Busboy drops files beyond `limits.files` silently, so the limit
 * is one above what a booking takes: the file too many is still seen and
 * refused by the limit of the booking. A file above the instance limit is
 * handed on cut off (`file.truncated`) for the service to answer with its
 * own reason.
 *
 * Afterwards `req.customerUploadFiles` holds the files, each `{ fieldId,
 * replacing, file }`, `replacing` null for a new one.
 *
 * @returns {import("express").RequestHandler[]}
 */
function acceptSubmissionFiles() {
  return [
    (req, res, next) =>
      fileUpload({
        limits: {
          fileSize: (customerUploadLimits().maxFileSizeMb + 1) * MEGABYTE,
          files: customerUploadLimits().maxFilesPerBooking + 1,
        },
        abortOnLimit: false,
      })(req, res, next),
    (req, res, next) => {
      const files = [];
      for (const [name, value] of Object.entries(req.files || {})) {
        if (!name.startsWith(CHECKOUT_FILE_PREFIX)) {
          return next(
            new BadRequestError("customer_upload_file_field_invalid"),
          );
        }
        const [fieldId, replacing = null, ...rest] = name
          .slice(CHECKOUT_FILE_PREFIX.length)
          .split(":");
        if (!fieldId || replacing === "" || rest.length > 0) {
          return next(
            new BadRequestError("customer_upload_file_field_invalid"),
          );
        }
        for (const file of [].concat(value)) {
          files.push({ fieldId, replacing, file });
        }
      }
      req.customerUploadFiles = files;
      return next();
    },
  ];
}

module.exports = {
  CHECKOUT_BODY_FIELD,
  CHECKOUT_FILE_PREFIX,
  acceptCheckoutFiles,
  acceptSingleFile,
  acceptSubmissionFiles,
  isUploadRoute,
  rejectMultipart,
};
