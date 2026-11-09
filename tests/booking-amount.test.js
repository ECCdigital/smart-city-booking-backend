const { expect } = require("chai");
const sinon = require("sinon");
const {
  parseBookingAmount,
  validateBookableItemAmounts,
  coerceBookableItemAmounts,
} = require("../src/commons/utilities/booking-amount");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const BookingModel = require("../src/commons/data-managers/models/bookingModel");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  BundleCheckoutService,
} = require("../src/commons/services/checkout/bundle-checkout-service");
const {
  ItemCheckoutService,
} = require("../src/commons/services/checkout/item-checkout-service");
const BookingService = require("../src/commons/services/checkout/booking-service");

describe("booking amount", () => {
  describe("parseBookingAmount", () => {
    it("accepts integers from 1, also as strings", () => {
      expect(parseBookingAmount(1)).to.equal(1);
      expect(parseBookingAmount(2)).to.equal(2);
      expect(parseBookingAmount("2")).to.equal(2);
      expect(parseBookingAmount(" 3 ")).to.equal(3);
    });

    it("rejects everything else", () => {
      for (const value of [
        "",
        "2,5",
        "2.5",
        2.5,
        "abc",
        0,
        "0",
        -1,
        "-1",
        undefined,
        null,
        NaN,
        Infinity,
        true,
        {},
      ]) {
        expect(parseBookingAmount(value), String(value)).to.equal(null);
      }
    });
  });

  describe("validateBookableItemAmounts", () => {
    it("converts valid amounts to numbers in place", () => {
      const items = [
        { bookableId: "a", amount: "2" },
        { bookableId: "b", amount: 1 },
      ];
      validateBookableItemAmounts(items);
      expect(items.map((i) => i.amount)).to.deep.equal([2, 1]);
    });

    it("throws a 400 error for an invalid or missing amount", () => {
      for (const item of [
        { bookableId: "a", amount: "" },
        { bookableId: "a", amount: "2,5" },
        { bookableId: "a", amount: 0 },
        { bookableId: "a" },
      ]) {
        expect(() => validateBookableItemAmounts([item]))
          .to.throw(Error)
          .with.nested.property("cause.code", 400);
      }
    });
  });

  describe("coerceBookableItemAmounts", () => {
    it("converts integer strings and leaves other values untouched", () => {
      const items = [
        { amount: "2" },
        { amount: "abc" },
        { amount: "" },
        { amount: 3 },
        {},
      ];
      coerceBookableItemAmounts(items);
      expect(items.map((i) => i.amount)).to.deep.equal([
        2,
        "abc",
        "",
        3,
        undefined,
      ]);
    });
  });
});

describe("BookingManager.storeBooking", () => {
  afterEach(() => sinon.restore());

  it("stores integer string amounts as numbers and never rejects other values", async () => {
    const updateOne = sinon.stub(BookingModel, "updateOne").resolves();

    await BookingManager.storeBooking({
      id: "B-1",
      tenantId: "t1",
      bookableItems: [
        { bookableId: "a", amount: "2" },
        { bookableId: "b", amount: "abc" },
        { bookableId: "c", amount: 1 },
      ],
    });

    const stored = updateOne.firstCall.args[1];
    expect(stored.bookableItems.map((i) => i.amount)).to.deep.equal([
      2,
      "abc",
      1,
    ]);
  });
});

describe("BookingService amount validation", () => {
  afterEach(() => sinon.restore());

  it("rejects a checkout with an invalid amount with 400", async () => {
    const getBookable = sinon.stub(BookableManager, "getBookable");

    let error;
    try {
      await BookingService.createBooking({
        tenantId: "t1",
        bookingAttempt: { bookableItems: [{ bookableId: "a", amount: "abc" }] },
        simulate: true,
      });
    } catch (err) {
      error = err;
    }

    expect(error?.cause?.code).to.equal(400);
    expect(getBookable.called).to.be.false;
  });

  it("converts the amount before comparing mandatory addons", async () => {
    sinon.stub(BookableManager, "getBookable").callsFake(async (id) =>
      id === "main"
        ? {
            id,
            checkoutBookableIds: [{ bookableId: "addon", mandatory: true }],
          }
        : { id },
    );
    let items;
    sinon
      .stub(BundleCheckoutService.prototype, "prepareBooking")
      .callsFake(async function () {
        items = this.bookableItems;
        throw new Error("stop");
      });

    await BookingService.createBooking({
      tenantId: "t1",
      bookingAttempt: {
        bookableItems: [
          { bookableId: "main", amount: "2" },
          { bookableId: "addon", amount: 2 },
        ],
      },
      simulate: true,
    }).catch(() => {});

    expect(items).to.deep.equal([
      { bookableId: "main", amount: 2 },
      { bookableId: "addon", amount: 2 },
    ]);
  });

  it("rejects a group checkout before storing anything if one amount is invalid", async () => {
    const createBooking = sinon.stub(BookingService, "createBooking");

    let error;
    try {
      await BookingService.createGroupBooking({
        tenantId: "t1",
        contactData: {},
        bookingAttempts: [
          { bookableItems: [{ bookableId: "a", amount: 1 }] },
          { bookableItems: [{ bookableId: "a", amount: -1 }] },
        ],
        simulate: false,
      });
    } catch (err) {
      error = err;
    }

    expect(error?.cause?.code).to.equal(400);
    expect(createBooking.called).to.be.false;
  });

  it("rejects editing a booking with an invalid amount with 400", async () => {
    sinon
      .stub(BookingManager, "getBooking")
      .resolves({ id: "B-1", tenantId: "t1" });
    const storeBooking = sinon.stub(BookingManager, "storeBooking");

    let error;
    try {
      await BookingService.updateBooking("t1", {
        id: "B-1",
        bookableItems: [{ bookableId: "a", amount: "2,5" }],
      });
    } catch (err) {
      error = err;
    }

    expect(error?.cause?.code).to.equal(400);
    expect(storeBooking.called).to.be.false;
  });
});

describe("ItemCheckoutService.calculateAmountBooked", () => {
  afterEach(() => sinon.restore());

  it("does not count rejected bookings for bookables without time relation", async () => {
    sinon.stub(BookingManager, "getRelatedBookings").resolves([
      {
        id: "rejected",
        isRejected: true,
        bookableItems: [{ bookableId: "ticket", amount: 1 }],
      },
      {
        id: "open",
        isRejected: false,
        bookableItems: [
          { bookableId: "ticket", amount: "2" },
          { bookableId: "other", amount: 5 },
        ],
      },
    ]);

    const service = new ItemCheckoutService(
      null,
      "t1",
      null,
      null,
      "ticket",
      1,
    );
    service.originBookable = { id: "ticket", tenantId: "t1" };

    const { amountBooked } = await service.calculateAmountBooked({
      id: "ticket",
      tenantId: "t1",
    });

    expect(amountBooked).to.equal(2);
  });
});
