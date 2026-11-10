const {
  CustomerUploadService,
} = require("../../../../commons/services/customer-upload/customer-upload-service");

/**
 * The customer uploads of a booking (glossary "Kunden-Upload", in the UI
 * "Nachweis"): the booking person hands one in for
 * an upload field, replaces it or deletes it while it is not checked yet.
 *
 * `admit` runs before the body is parsed: the booking, the field and the
 * rate limit. Every answer of a success is the derived state of the
 * booking's uploads, `{ customerUploadState }`; every refusal a code of
 * `CUSTOMER_UPLOAD_REASONS`.
 */
class CustomerUploadControllerV2 {
  /** Booking, field and rate limit, for an upload or a replacement. */
  static async admitUpload(req, res, next) {
    req.customerUpload = await CustomerUploadService.admit(
      CustomerUploadControllerV2._params(req),
    );
    next();
  }

  /** Booking and rate limit, for a deletion. */
  static async admitRemoval(req, res, next) {
    req.customerUpload = await CustomerUploadService.admit({
      ...CustomerUploadControllerV2._params(req),
      forUpload: false,
    });
    next();
  }

  /** A file for an upload field of the booking. */
  static async upload(req, res) {
    await CustomerUploadService.upload(
      req.customerUpload,
      CustomerUploadControllerV2._file(req),
    );
    return CustomerUploadControllerV2._answerState(req, res, 201);
  }

  static async replace(req, res) {
    await CustomerUploadService.replace(
      req.customerUpload,
      req.params.mediaId,
      CustomerUploadControllerV2._file(req),
    );
    return CustomerUploadControllerV2._answerState(req, res, 200);
  }

  static async remove(req, res) {
    await CustomerUploadService.remove(req.customerUpload, req.params.mediaId);
    return CustomerUploadControllerV2._answerState(req, res, 200);
  }

  static _params(req) {
    return {
      tenantId: req.params.tenant,
      bookingId: req.params.id,
      fieldId: req.params.fieldId,
      userId: req.principal?.userId ?? null,
      ip: req.ip || req.socket?.remoteAddress || "unknown",
    };
  }

  /** The one file of the request, whatever its form field is called. */
  static _file(req) {
    return Object.values(req.files || {}).flat()[0] ?? null;
  }

  static async _answerState(req, res, status) {
    return res.status(status).json({
      customerUploadState: await CustomerUploadService.stateAfter(
        req.customerUpload,
      ),
    });
  }
}

module.exports = CustomerUploadControllerV2;
