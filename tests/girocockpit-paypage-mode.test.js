/**
 * The payment page GiroCockpit opens shows the payment methods of the mode
 * the request asks for (ECCdigital/tickets#796): GiroCheckout's `test` is
 * `1` for the methods in test mode and `0` for those in live mode. A live
 * project in Girocockpit 2.0 has only live methods, so a request with
 * `test=1` opens a page without a single payment method. The tenant's
 * `paymentMode` decides: `"test"` asks for test mode, anything else, the
 * unset default `""` included, for live mode.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const crypto = require("crypto");
const axios = require("axios");

const GiroCockpitPaymentService = require("../src/commons/services/payment/providers/GiroCockpitPaymentService");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const BookingManager = require("../src/commons/data-managers/booking-manager");

const TENANT = "amt";
const SECRET = "projekt-passwort";

describe("GiroCockpit asks for the payment methods of the tenant's mode", function () {
  let adapter;
  let posted;

  beforeEach(function () {
    adapter = axios.defaults.adapter;
    posted = [];
    axios.defaults.adapter = async (config) => {
      posted.push(Object.fromEntries(new URLSearchParams(config.data)));
      return {
        data: { rc: 0, url: "https://pay.example.test/page" },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };
    sinon
      .stub(BookingManager, "getBooking")
      .callsFake(async (id) => ({ id, priceEur: 12.5 }));
    sinon
      .stub(BookingManager, "getBookings")
      .callsFake(async (tenantId, ids) =>
        ids.map((id) => ({ id, priceEur: 12.5 })),
      );
  });

  afterEach(function () {
    axios.defaults.adapter = adapter;
    sinon.restore();
  });

  function givenTenantApp(fields) {
    const app = {
      id: "giroCockpit",
      active: true,
      paymentMerchantId: "1234567",
      paymentProjectId: "4711",
      paymentSecret: SECRET,
      paymentPurposeSuffix: "",
      ...fields,
    };
    sinon
      .stub(TenantModel, "findOne")
      .resolves({ toEntity: () => ({ applications: [app] }) });
  }

  function hashOf(form) {
    const order = [
      "merchantId",
      "projectId",
      "merchantTxId",
      "amount",
      "currency",
      "purpose",
      "type",
      "test",
      "successUrl",
      "backUrl",
      "failUrl",
      "notifyUrl",
    ];
    return crypto
      .createHmac("md5", SECRET)
      .update(order.map((k) => form[k]).join(""))
      .digest("hex");
  }

  const requests = {
    "a single booking": () =>
      new GiroCockpitPaymentService(TENANT, "B-1").createPayment(),
    "a group payment": () =>
      new GiroCockpitPaymentService(TENANT, ["B-1", "B-2"], {
        aggregated: true,
        groupBookingId: "G-1",
      }).createPayment(),
  };

  for (const [what, request] of Object.entries(requests)) {
    describe(what, function () {
      for (const [paymentMode, test] of [
        [undefined, "0"],
        ["", "0"],
        ["prod", "0"],
        ["test", "1"],
      ]) {
        it(`asks with test=${test} for paymentMode ${JSON.stringify(paymentMode)}, and the hash covers it`, async function () {
          givenTenantApp(paymentMode === undefined ? {} : { paymentMode });

          await request();

          expect(posted).to.have.length(1);
          expect(posted[0].test).to.equal(test);
          expect(posted[0].hash).to.equal(hashOf(posted[0]));
        });
      }
    });
  }
});
