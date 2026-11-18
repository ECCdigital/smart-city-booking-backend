/**
 * Private or business booking (`isBusiness`, GLOSSARY.md "Geschäftliche
 * Buchung"), seen through the HTTP form: the checkout stores the booker's
 * answer, or without one reads it off the company; a group stores it on
 * every member; an edit keeps it unless the form names one.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  checkoutBody,
  adminForm,
  TENANT,
  ADMIN,
  CUSTOMER,
  TIME_BEGIN,
  TIME_END,
  DAY,
} = require("./helpers/booking-lifecycle-harness");
const {
  isBusinessOf,
  isPrivateBooking,
} = require("../src/commons/services/checkout/business-booking");

describe("Geschäftliche Buchung: private or business", function () {
  describe("the rule", function () {
    it("takes the booker's answer where it is a boolean", function () {
      expect(isBusinessOf(true, "")).to.equal(true);
      expect(isBusinessOf(false, "Musterfirma GmbH")).to.equal(false);
    });

    it("reads a missing answer off the company, blanks as none", function () {
      expect(isBusinessOf(undefined, "Musterfirma GmbH")).to.equal(true);
      expect(isBusinessOf(undefined, "  ")).to.equal(false);
      expect(isBusinessOf(null, undefined)).to.equal(false);
      expect(isBusinessOf("true", "")).to.equal(false);
    });

    it("calls a booking private by its answer, without one by its company", function () {
      expect(isPrivateBooking({ isBusiness: false, company: "X" })).to.equal(
        true,
      );
      expect(isPrivateBooking({ isBusiness: true, company: "" })).to.equal(
        false,
      );
      expect(isPrivateBooking({ company: "X" })).to.equal(false);
      expect(isPrivateBooking({ company: "" })).to.equal(true);
    });
  });

  describe("over HTTP", function () {
    let h;

    beforeEach(async function () {
      h = await installHarness();
    });

    afterEach(async function () {
      sinon.restore();
      await h.close();
    });

    const api = () => h.api();

    async function checkoutV2(overrides = {}) {
      const res = await api()
        .post(`/api/v2/${TENANT}/checkout`)
        .send(checkoutBody("room", overrides));
      expect(res.status).to.equal(200);
      return res.body.data.booking.id;
    }

    const update = (id, changes) =>
      api()
        .put(`/api/${TENANT}/bookings`)
        .set(h.as(ADMIN))
        .send(adminForm(h.stored(id), changes));

    it("stores the booker's answer", async function () {
      const business = await checkoutV2({ company: "", isBusiness: true });
      const privat = await checkoutV2({
        company: "Musterfirma GmbH",
        isBusiness: false,
      });

      expect(h.stored(business).isBusiness).to.equal(true);
      expect(h.stored(privat).isBusiness).to.equal(false);
    });

    it("reads a body without the answer off the company", async function () {
      const withCompany = await checkoutV2({ company: "Musterfirma GmbH" });
      const withoutCompany = await checkoutV2({ company: "" });

      expect(h.stored(withCompany).isBusiness).to.equal(true);
      expect(h.stored(withoutCompany).isBusiness).to.equal(false);
    });

    it("stores the answer on every booking of a group", async function () {
      const res = await api()
        .post(`/api/v2/${TENANT}/checkout/group`)
        .send({
          bookableItems: [{ bookableId: "room", amount: 1 }],
          bookingAttempts: [
            { timeBegin: TIME_BEGIN, timeEnd: TIME_END },
            { timeBegin: TIME_BEGIN + DAY, timeEnd: TIME_END + DAY },
          ],
          name: "Erika Muster",
          mail: CUSTOMER,
          company: "Musterfirma GmbH",
          isBusiness: false,
          paymentProvider: "giroCockpit",
        });

      expect(res.status).to.equal(200);
      expect(
        h.members(res.body.data.groupBooking.id).map((b) => b.isBusiness),
      ).to.deep.equal([false, false]);
    });

    it("an edit keeps the answer when the form names none", async function () {
      const id = await checkoutV2({ company: "", isBusiness: true });
      const form = adminForm(h.stored(id), { company: "" });
      delete form.isBusiness;

      const put = await api()
        .put(`/api/${TENANT}/bookings`)
        .set(h.as(ADMIN))
        .send(form);

      expect(put.status).to.equal(201);
      expect(h.stored(id).isBusiness).to.equal(true);
    });

    it("an edit takes the answer the form names", async function () {
      const id = await checkoutV2({ company: "", isBusiness: false });

      const put = await update(id, { isBusiness: true });

      expect(put.status).to.equal(201);
      expect(h.stored(id).isBusiness).to.equal(true);
    });

    it("a booking from before has none, and an edit without one gives it none", async function () {
      const id = await checkoutV2();
      delete h.stored(id).isBusiness;
      const form = adminForm(h.stored(id), {});
      delete form.isBusiness;

      const put = await api()
        .put(`/api/${TENANT}/bookings`)
        .set(h.as(ADMIN))
        .send(form);

      expect(put.status).to.equal(201);
      expect(h.stored(id)).to.not.have.property("isBusiness");
    });
  });
});
