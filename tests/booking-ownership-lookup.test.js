/**
 * The public lookups of a booking by its booker's name: an unknown booking
 * answers `404`, a name that is not one string `400` - never a `500` from
 * reading the missing booking or calling a string method on a query object.
 * The routes run on the tenant router as `server.js` mounts it, the booking
 * is read through `BookingManager` from the stubbed `BookingModel`.
 */

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const sinon = require("sinon");

const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { errorHandler } = require("../src/middleware/error-handler");

const TENANT = "tenant-1";

function createApp() {
  const app = express();
  app.use(
    "/api/:tenant",
    require("../src/platform/api/api-router-tenant-related"),
  );
  app.use(errorHandler);
  return app;
}

describe("public booking lookups by name", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("GET /api/:tenant/bookings/:id/verify-ownership", function () {
    it("answers 404 for a booking that does not exist", async function () {
      const findOne = sinon.stub(BookingModel, "findOne").resolves(null);

      const response = await request(createApp())
        .get(`/api/${TENANT}/bookings/UNKNOWN-1/verify-ownership`)
        .query({ name: "Erika Mustermann" });

      assert.strictEqual(response.status, 404);
      sinon.assert.calledOnce(findOne);
      assert.strictEqual(findOne.firstCall.args[0].id, "UNKNOWN-1");
      assert.strictEqual(findOne.firstCall.args[0].tenantId, TENANT);
    });

    it("answers 200 for the booker's name, whatever its case", async function () {
      sinon
        .stub(BookingManager, "getBooking")
        .resolves({ id: "ABCD-1234", name: "Erika Mustermann" });

      const response = await request(createApp())
        .get(`/api/${TENANT}/bookings/ABCD-1234/verify-ownership`)
        .query({ name: "erika mustermann" });

      assert.strictEqual(response.status, 200);
    });

    it("answers 401 for another name", async function () {
      sinon
        .stub(BookingManager, "getBooking")
        .resolves({ id: "ABCD-1234", name: "Erika Mustermann" });

      const response = await request(createApp())
        .get(`/api/${TENANT}/bookings/ABCD-1234/verify-ownership`)
        .query({ name: "Max Mustermann" });

      assert.strictEqual(response.status, 401);
    });

    for (const [label, query] of [
      ["a list", "name=Erika&name=Max"],
      ["an object", "name[$ne]=x"],
    ]) {
      it(`answers 400 for a name given as ${label}, before any read`, async function () {
        const findOne = sinon.stub(BookingModel, "findOne").resolves(null);

        const response = await request(createApp()).get(
          `/api/${TENANT}/bookings/ABCD-1234/verify-ownership?${query}`,
        );

        assert.strictEqual(response.status, 400);
        sinon.assert.notCalled(findOne);
      });
    }
  });

  describe("GET /api/:tenant/bookings/:id/cancellation-refund-preview/public", function () {
    it("answers 404 for a booking that does not exist", async function () {
      sinon.stub(BookingModel, "findOne").resolves(null);

      const response = await request(createApp())
        .get(
          `/api/${TENANT}/bookings/UNKNOWN-1/cancellation-refund-preview/public`,
        )
        .query({ name: "Erika Mustermann" });

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.text, "booking_not_found");
    });
  });

  describe("GET /api/:tenant/bookings/:id/status/public", function () {
    for (const [label, query] of [
      ["a list", "lastname=Erika&lastname=Max"],
      ["an object", "lastname[$ne]=x"],
    ]) {
      it(`answers 400 for a last name given as ${label}, before any read`, async function () {
        const findOne = sinon.stub(BookingModel, "findOne").resolves(null);

        const response = await request(createApp()).get(
          `/api/${TENANT}/bookings/ABCD-1234/status/public?${query}`,
        );

        assert.strictEqual(response.status, 400);
        sinon.assert.notCalled(findOne);
      });
    }
  });
});
