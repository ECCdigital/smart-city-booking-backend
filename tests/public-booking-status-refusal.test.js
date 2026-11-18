const { expect } = require("chai");
const sinon = require("sinon");
const harness = require("./helpers/booking-lifecycle-harness");
const { installHarness, TENANT } = harness;

describe("public booking status: refusals are answered", function () {
  this.timeout(30000);
  let h, id;
  before(async function () {
    h = await installHarness();
    id = (await h.manualBooking("ticket")).id;
  });
  after(async function () {
    sinon.restore();
    await h.close();
  });
  for (const [status, on, ref, what] of [
    [405, false, () => "X", "the status view off, the default"],
    [401, true, () => id, "a name that does not match"],
    [404, true, () => "X", "an unknown booking"],
  ]) {
    it(`${status} for ${what}`, async function () {
      h.tenant.enablePublicStatusView = on;
      const res = await h
        .api()
        .get(`/api/${TENANT}/bookings/${ref()}/status/public?lastname=x`)
        .timeout({ response: 2000 });
      expect(res.status).to.equal(status);
    });
  }
});
