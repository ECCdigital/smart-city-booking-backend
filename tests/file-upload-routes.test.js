const assert = require("assert");
const express = require("express");
const request = require("supertest");

const {
  acceptSingleFile,
  isUploadRoute,
  rejectMultipart,
} = require("../src/middleware/file-upload");
const { errorHandler } = require("../src/middleware/error-handler");

/**
 * A bare app wired like `server.js`: the global guard first, files only on the
 * upload route.
 */
function app() {
  const app = express();
  app.use(rejectMultipart);
  app.use(express.json());
  app.post("/api/v2/:tenant/media", acceptSingleFile(), (req, res) =>
    res.status(201).json({
      name: req.files?.file?.name ?? null,
      title: req.body?.name ?? null,
    }),
  );
  app.post("/api/v2/:tenant/bookings", (req, res) =>
    res.status(200).json({ body: req.body, files: req.files ?? null }),
  );
  app.post("/api/:tenant/bookables", (req, res) =>
    res.status(200).json({ files: req.files ?? null }),
  );
  app.use(errorHandler);
  return app;
}

const PDF = Buffer.from("%PDF-1.4\n%fixture\n");

describe("File uploads only on the upload routes", function () {
  it("accepts one file on the tenant upload route", async function () {
    const res = await request(app())
      .post("/api/v2/tenant1/media")
      .field("name", "Flyer")
      .attach("file", PDF, "flyer.pdf");

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.name, "flyer.pdf");
    assert.strictEqual(res.body.title, "Flyer");
  });

  it("accepts one file on the instance upload route", async function () {
    const res = await request(app())
      .post("/api/v2/instance/media/")
      .attach("file", PDF, "flyer.pdf");

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.name, "flyer.pdf");
  });

  it("rejects two files in one field", async function () {
    const res = await request(app())
      .post("/api/v2/tenant1/media")
      .attach("file", PDF, "a.pdf")
      .attach("file", PDF, "b.pdf");

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, "multiple_files_not_supported");
  });

  it("rejects two files in different fields", async function () {
    const res = await request(app())
      .post("/api/v2/tenant1/media")
      .attach("file", PDF, "a.pdf")
      .attach("other", PDF, "b.pdf")
      .attach("third", PDF, "c.pdf");

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, "multiple_files_not_supported");
  });

  it("rejects files on any other v2 route", async function () {
    const res = await request(app())
      .post("/api/v2/tenant1/bookings")
      .attach("file", PDF, "flyer.pdf");

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, "multipart_not_supported");
  });

  it("rejects files on legacy routes", async function () {
    const res = await request(app())
      .post("/api/tenant1/bookables")
      .attach("file", PDF, "flyer.pdf");

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, "multipart_not_supported");
  });

  it("rejects multipart on a sub-path of the upload route", async function () {
    const res = await request(app())
      .post("/api/v2/tenant1/media/some-id")
      .attach("file", PDF, "flyer.pdf");

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, "multipart_not_supported");
  });

  it("leaves JSON bodies on other routes alone", async function () {
    const res = await request(app())
      .post("/api/v2/tenant1/bookings")
      .send({ hello: "world" });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.body, { hello: "world" });
    assert.strictEqual(res.body.files, null);
  });

  // The single checkout with the customer uploads of its upload fields,
  // and the group checkout.
  it("lets files through on the checkout of a single booking and of a group", function () {
    const routeOf = (method, path) => isUploadRoute({ method, path });

    assert.strictEqual(routeOf("POST", "/api/v2/tenant1/checkout"), true);
    assert.strictEqual(routeOf("POST", "/api/tenant1/checkout"), true);
    assert.strictEqual(routeOf("POST", "/api/v2/tenant1/checkout/group"), true);
    assert.strictEqual(routeOf("POST", "/api/tenant1/checkout/group"), true);
    assert.strictEqual(
      routeOf("POST", "/api/v2/tenant1/checkout/validate-group"),
      false,
    );
    assert.strictEqual(
      routeOf("POST", "/api/tenant1/checkout/validateItem"),
      false,
    );
    assert.strictEqual(routeOf("PUT", "/api/v2/tenant1/checkout"), false);
  });
});
