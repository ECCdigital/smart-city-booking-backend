class BaseError extends Error {
  constructor(code, statusCode = 500, params = {}) {
    super(code);
    this.name = "BaseError";
    this.code = code;
    this.statusCode = statusCode;
    this.params = params;
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      statusCode: this.statusCode,
      params: this.params,
    };
  }
}

class NotFoundError extends BaseError {
  constructor(code = "not_found", params = {}) {
    super(code, 404, params);
    this.name = "NotFoundError";
  }
}

class BadRequestError extends BaseError {
  constructor(code = "bad_request", params = {}) {
    super(code, 400, params);
    this.name = "BadRequestError";
  }
}

class UnauthorizedError extends BaseError {
  constructor(code = "unauthorized", params = {}) {
    super(code, 401, params);
    this.name = "UnauthorizedError";
  }
}

class ForbiddenError extends BaseError {
  constructor(code = "forbidden", params = {}) {
    super(code, 403, params);
    this.name = "ForbiddenError";
  }
}

class MethodNotAllowedError extends BaseError {
  constructor(code = "method_not_allowed", params = {}) {
    super(code, 405, params);
    this.name = "MethodNotAllowedError";
  }
}

class ConflictError extends BaseError {
  constructor(code = "conflict", params = {}) {
    super(code, 409, params);
    this.name = "ConflictError";
  }
}

module.exports = {
  BaseError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
  ConflictError,
};
