const assert = require("assert");
const sinon = require("sinon");
const {
  primaryEmailFromMail,
} = require("../src/commons/utilities/checkout-utils");
const {
  BundleCheckoutService,
  ManualBundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");

describe("primaryEmailFromMail", () => {
  it("returns the first email in lowercase", () => {
    assert.strictEqual(
      primaryEmailFromMail("Nutzer@Example.com"),
      "nutzer@example.com",
    );
  });

  it("uses the first address from multi-email values", () => {
    assert.strictEqual(
      primaryEmailFromMail("first@example.com, second@example.com"),
      "first@example.com",
    );
  });

  it("returns an empty string when mail is missing", () => {
    assert.strictEqual(primaryEmailFromMail(""), "");
    assert.strictEqual(primaryEmailFromMail(null), "");
  });
});

describe("ManualBundleCheckoutService assignedUserId", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("sets assignedUserId from the booking email instead of the admin user", async () => {
    sinon.stub(BundleCheckoutService.prototype, "prepareBooking").resolves({
      assignedUserId: "admin@example.com",
      mail: "Nutzer@Example.com",
    });

    const service = new ManualBundleCheckoutService({
      user: "admin@example.com",
      tenant: "tenant-1",
      timeBegin: Date.now(),
      timeEnd: Date.now() + 3600000,
      bookableItems: [],
      email: "Nutzer@Example.com",
      name: "Nutzer",
      isCommit: true,
      isPayed: true,
      isRejected: false,
    });

    const booking = await service.prepareBooking();

    assert.strictEqual(booking.assignedUserId, "nutzer@example.com");
    assert.strictEqual(booking.mail, "Nutzer@Example.com");
  });
});
