class IfbsApiError extends Error {
  constructor(endpoint, data) {
    super(data.ErrMsg || `IFBS API error on ${endpoint}`);
    this.name = "IfbsApiError";
    this.endpoint = endpoint;
    this.errNo = data.ErrNo || null;
    this.errMsg = data.ErrMsg || null;
  }
}

module.exports = IfbsApiError;
