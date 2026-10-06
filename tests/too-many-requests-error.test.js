const assert = require("assert");
const express = require("express");
const request = require("supertest");

const {
  TooManyRequestsError,
  BadRequestError,
} = require("../src/errors/BaseError");
const { errorHandler } = require("../src/middleware/error-handler");
const ApiResponse = require("../src/commons/utilities/api-response");

function appWith(handler) {
  const app = express();
  app.get("/", handler);
  app.use(errorHandler);
  return app;
}

describe("TooManyRequestsError", function () {
  it("is a 429 with a Retry-After header through the error handler", async function () {
    const app = appWith((req, res, next) =>
      next(
        new TooManyRequestsError("too_many_requests", {
          retryAfterSeconds: 42,
        }),
      ),
    );

    const res = await request(app).get("/");

    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.headers["retry-after"], "42");
    assert.strictEqual(res.body.code, "too_many_requests");
    assert.strictEqual(res.body.params.retryAfterSeconds, 42);
  });

  it("is a 429 with a Retry-After header through ApiResponse.fail", async function () {
    const app = appWith((req, res) =>
      ApiResponse.fail(
        res,
        new TooManyRequestsError(undefined, { retryAfterSeconds: 7 }),
      ),
    );

    const res = await request(app).get("/");

    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.headers["retry-after"], "7");
    assert.strictEqual(res.body.code, "too_many_requests");
  });

  it("sets no Retry-After on an error without a wait", async function () {
    const app = appWith((req, res, next) => next(new BadRequestError()));

    const res = await request(app).get("/");

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers["retry-after"], undefined);
  });
});
