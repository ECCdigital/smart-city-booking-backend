class ApiResponse {
  static ok(res, data = {}) {
    return res.status(200).json({ success: true, ...data });
  }

  static created(res, data = {}) {
    return res.status(201).json({ success: true, ...data });
  }

  /**
   * A processable refusal: the request was understood and answered, but the
   * operation was refused for a reason the client is expected to render. Stays
   * on HTTP 200 so those cases are not mixed up with transport or auth errors.
   * @param {import("express").Response} res Response to send
   * @param {Object} [data={}] Body fields next to `success`, usually `{ data }`
   * @returns {import("express").Response} The sent response
   */
  static softFail(res, data = {}) {
    return res.status(200).json({ success: false, ...data });
  }

  static badRequest(res, message = "Bad request") {
    return res.status(400).json({ success: false, error: message });
  }

  static forbidden(res, message = "Forbidden") {
    return res.status(403).json({ success: false, error: message });
  }

  static notFound(res, message = "Not found") {
    return res.status(404).json({ success: false, error: message });
  }

  static error(res, message = "Internal server error") {
    return res.status(500).json({ success: false, error: message });
  }

  /**
   * Answers a `BaseError` in the one JSON form the central error handler
   * uses (`{ error, code, statusCode, params }`), for a handler that answers
   * itself instead of passing the error to `next`.
   * @param {import("express").Response} res Response to send
   * @param {import("../../errors/BaseError").BaseError} error The error
   * @returns {import("express").Response} The sent response
   */
  static fail(res, error) {
    return res.status(error.statusCode).json(error.toJSON());
  }
}

module.exports = ApiResponse;
