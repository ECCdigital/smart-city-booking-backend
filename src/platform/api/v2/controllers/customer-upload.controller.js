const {
  CustomerUploadService,
  CUSTOMER_UPLOAD_REASONS,
} = require("../../../../commons/services/customer-upload/customer-upload-service");
const { BadRequestError } = require("../../../../errors/BaseError");
const {
  CustomerUploadReview,
} = require("../../../../commons/services/customer-upload/customer-upload-review");

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

  /**
   * Booking and rate limit, for every proof of the booking at once;
   * the fields are checked per file.
   */
  static async admitSubmission(req, res, next) {
    req.customerUpload = await CustomerUploadService.admit({
      ...CustomerUploadControllerV2._params(req),
      forUpload: false,
    });
    next();
  }

  /** Booking and rate limit for every proof of a guest's booking at once. */
  static async admitSubmissionByLink(req, res, next) {
    req.customerUpload = await CustomerUploadService.admitByLink({
      ...CustomerUploadControllerV2._linkParams(req),
      forUpload: false,
    });
    next();
  }

  /**
   * Every proof of the booking at once, the button „Nachweise einreichen“:
   * new files and replacements, each accepted or
   * refused on its own, and one notice to the staff for the ones stored.
   * Answers `{ customerUploadState, refused }` - `201` where a file was
   * stored, `200` where every one was refused - each refused file with its
   * position in the request (`index`), field, name, code and params.
   */
  static async submit(req, res) {
    // The other bookings of the group each new file counts for too, by its
    // position in the request: the form field `alsoFor` as JSON `{ "<index>":
    // [{ bookingId, fieldId }] }`.
    const alsoFor = CustomerUploadControllerV2._alsoFor(req) ?? {};
    if (typeof alsoFor !== "object" || Array.isArray(alsoFor)) {
      throw new BadRequestError(CUSTOMER_UPLOAD_REASONS.TARGET_INVALID);
    }
    const entries = (req.customerUploadFiles ?? []).map((entry, index) => ({
      ...entry,
      alsoFor: alsoFor[index] ?? null,
    }));
    const { stored, refused } = await CustomerUploadService.submitAll(
      req.customerUpload,
      entries,
    );
    return res.status(stored.length > 0 ? 201 : 200).json({
      customerUploadState: await CustomerUploadService.stateAfter(
        req.customerUpload,
      ),
      refused,
    });
  }

  /**
   * Booking, field and rate limit for a guest with the signed link of the
   * booking, the token in the header
   * `X-Customer-Upload-Link`.
   */
  static async admitUploadByLink(req, res, next) {
    req.customerUpload = await CustomerUploadService.admitByLink(
      CustomerUploadControllerV2._linkParams(req),
    );
    next();
  }

  /** Booking and rate limit for a guest's deletion. */
  static async admitRemovalByLink(req, res, next) {
    req.customerUpload = await CustomerUploadService.admitByLink({
      ...CustomerUploadControllerV2._linkParams(req),
      forUpload: false,
    });
    next();
  }

  /**
   * The one booking of a guest's link, for the page „Nachweise einreichen“
   * without an account: what the page shows of it,
   * its provider and the derived state of its uploads - no more of the
   * booking than that.
   */
  static async readByLink(req, res) {
    const booking = await CustomerUploadService.bookingOfLink({
      tenantId: req.params.tenant,
      bookingId: req.params.id,
      link: CustomerUploadControllerV2._link(req),
    });
    res.set("Cache-Control", "no-store");
    return res
      .status(200)
      .json(await CustomerUploadService.guestViewOf(booking));
  }

  /**
   * A file for an upload field of the booking. In a group the booking
   * person names the fields of other bookings of the group it counts for
   * too, in the form field `alsoFor` as JSON `[{ bookingId, fieldId }]`;
   * a guest has no such choice.
   */
  static async upload(req, res) {
    await CustomerUploadService.upload(
      req.customerUpload,
      CustomerUploadControllerV2._file(req),
      { alsoFor: CustomerUploadControllerV2._alsoFor(req) },
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

  /**
   * The check of a customer upload by the staff:
   * `{ result: "accepted" | "rejected", reason }`. Answers the derived state
   * of the booking afterwards, the reviewer's name included.
   */
  static async review(req, res) {
    await CustomerUploadReview.review({
      tenantId: req.params.tenant,
      bookingId: req.params.id,
      fieldId: req.params.fieldId,
      mediaId: req.params.mediaId,
      result: req.body?.result,
      reason: req.body?.reason,
      // An upload of a group: the other bookings the check counts for;
      // all of them without.
      alsoFor: req.body?.alsoFor ?? null,
      user: req.user,
    });
    return CustomerUploadControllerV2._answerStaffState(req, res);
  }

  /** „Erneut anfordern“ of a checked upload field: `{ reason }`. */
  static async requestAgain(req, res) {
    await CustomerUploadReview.requestAgain({
      tenantId: req.params.tenant,
      bookingId: req.params.id,
      fieldId: req.params.fieldId,
      reason: req.body?.reason,
      user: req.user,
    });
    return CustomerUploadControllerV2._answerStaffState(req, res);
  }

  static async _answerStaffState(req, res) {
    return res.status(200).json({
      customerUploadState: await CustomerUploadReview.stateOf(
        req.params.tenant,
        req.params.id,
      ),
    });
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

  static _link(req) {
    return req.get("x-customer-upload-link") ?? "";
  }

  static _linkParams(req) {
    return {
      tenantId: req.params.tenant,
      bookingId: req.params.id,
      fieldId: req.params.fieldId,
      link: CustomerUploadControllerV2._link(req),
      ip: req.ip || req.socket?.remoteAddress || "unknown",
    };
  }

  /** The other bookings of `alsoFor`; null where the form has none. */
  static _alsoFor(req) {
    const raw = req.body?.alsoFor;
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw !== "string") return raw;
    try {
      return JSON.parse(raw);
    } catch {
      throw new BadRequestError(CUSTOMER_UPLOAD_REASONS.TARGET_INVALID);
    }
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
