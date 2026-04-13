class ApiResponse {
  static ok(res, data = {}) {
    return res.status(200).json({ success: true, ...data });
  }

  static created(res, data = {}) {
    return res.status(201).json({ success: true, ...data });
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
}

module.exports = ApiResponse;