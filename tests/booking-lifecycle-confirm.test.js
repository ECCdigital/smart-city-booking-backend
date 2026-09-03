/**
 * The transition `confirm` of the booking lifecycle (spec part 2, section
 * 8), run over the in-memory adapters against its effect table as data:
 * `requested → payment_due` with the payment request (glossary
 * "Zahlungsaufforderung") for a priced booking, `requested → confirmed`
 * with grant and the free booking confirmation for a free one; the
 * workflow event `onCommit` after the write, the organizer told of a
 * ticket position.
 */

const { expect } = require("chai");

const {
  createBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/booking-lifecycle");
const {
  LifecycleError,
} = require("../src/commons/services/booking-lifecycle/pipeline");
const {
  TRIGGER,
} = require("../src/commons/services/booking-lifecycle/booking-state");
const { ConflictError, NotFoundError } = require("../src/errors/BaseError");
const {
  inMemoryAdapters,
  effectTable,
} = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    status: "requested",
    priceEur: 40,
    paymentProvider: "giroCockpit",
    mail: "erika@example.test",
    name: "Erika Muster",
    attachments: [],
    bookableItems: [
      { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
    ],
    ...overrides,
  };
}

describe("booking lifecycle: confirm", function () {
  function lifecycleOver(options) {
    const adapters = inMemoryAdapters(options);
    return { adapters, lifecycle: createBookingLifecycle(adapters) };
  }

  it("confirms a priced request: state write to payment due, workflow event, then the payment request", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.confirm(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.provision skipped",
      "notify workflow.emit ok",
      "notify mail.FREE_BOOKING_CONFIRMATION skipped",
      "notify payment.requestPayment ok",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(outcome).to.include({
      transition: "confirm",
      bookingId: "B-1",
      status: "payment_due",
      failure: null,
    });
    expect(adapters.store.rows.get("B-1")).to.include({
      status: "payment_due",
      isCommitted: true,
      isPayed: false,
    });
    expect(adapters.store.calls).to.deep.equal([
      { op: "save", args: ["B-1", "requested"] },
    ]);
    expect(adapters.workflow.calls).to.deep.equal([
      { op: "emit", args: [TENANT, "B-1", "onCommit"] },
    ]);
    expect(adapters.payment.calls).to.deep.equal([
      {
        op: "requestPayment",
        args: [
          {
            tenantId: TENANT,
            bookingIds: ["B-1"],
            paymentProvider: "giroCockpit",
            groupBookingId: null,
          },
        ],
      },
    ]);
    expect(adapters.access.calls).to.deep.equal([]);
    expect(adapters.mail.calls).to.deep.equal([]);
  });

  it("confirms a free request: state write to confirmed, grant, workflow event, the free booking confirmation", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking({ priceEur: 0 })],
    });

    const outcome = await lifecycle.confirm(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.provision ok",
      "notify workflow.emit ok",
      "notify mail.FREE_BOOKING_CONFIRMATION ok",
      "notify payment.requestPayment skipped",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(outcome).to.include({ status: "confirmed", failure: null });
    expect(adapters.store.rows.get("B-1")).to.include({
      status: "confirmed",
      isCommitted: true,
      isPayed: true,
    });
    expect(adapters.access.calls).to.deep.equal([
      { op: "provision", args: [TENANT, "B-1"] },
    ]);
    expect(adapters.payment.calls).to.deep.equal([]);
    const [mail] = adapters.mail.calls;
    expect(mail.args[0]).to.equal("FREE_BOOKING_CONFIRMATION");
    expect(mail.args[1].bookingIds).to.deep.equal(["B-1"]);
    expect(mail.args[1]).to.deep.equal({
      tenantId: TENANT,
      bookingIds: ["B-1"],
      groupBookingId: null,
    });
  });

  it("confirms a priced request of a tenant without a payment service: the payment request is skipped, the booking awaits payment", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [booking()],
      skipOn: { payment: ["requestPayment"] },
    });

    const outcome = await lifecycle.confirm(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.provision skipped",
      "notify workflow.emit ok",
      "notify mail.FREE_BOOKING_CONFIRMATION skipped",
      "notify payment.requestPayment skipped",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(outcome).to.include({ status: "payment_due", failure: null });
    expect(adapters.store.rows.get("B-1").status).to.equal("payment_due");
  });

  describe("the notice of the payment request, from the provider's answer", function () {
    const table = (form) => [
      "persist store.save ok",
      "provision access.provision skipped",
      "notify workflow.emit ok",
      "notify mail.FREE_BOOKING_CONFIRMATION skipped",
      "notify payment.requestPayment ok",
      `notify mail.PAYMENT_LINK_AFTER_APPROVAL ${form === "link" ? "ok" : "skipped"}`,
      `notify mail.INVOICE_AFTER_APPROVAL ${form === "invoice" ? "ok" : "skipped"}`,
      `notify mail.BOOKING_CONFIRMED_INVOICE_PENDING ${form === "pending" ? "ok" : "skipped"}`,
      "notify mail.NEW_BOOKING skipped",
    ];

    it("a link: the payment link mail with the provider's URL", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        paymentRequest: {
          form: "link",
          paymentUrl: "https://pay.example.test/x",
        },
      });

      const outcome = await lifecycle.confirm(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal(table("link"));
      expect(adapters.mail.calls).to.deep.equal([
        {
          op: "send",
          args: [
            "PAYMENT_LINK_AFTER_APPROVAL",
            {
              tenantId: TENANT,
              bookingIds: ["B-1"],
              groupBookingId: null,
              paymentUrl: "https://pay.example.test/x",
            },
          ],
        },
      ]);
    });

    it("an invoice: the invoice mail with the file the provider issued", async function () {
      const file = { name: "RG-1.pdf", buffer: Buffer.from("%PDF") };
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        paymentRequest: { form: "invoice", files: [file] },
      });

      const outcome = await lifecycle.confirm(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal(table("invoice"));
      expect(adapters.mail.calls).to.deep.equal([
        {
          op: "send",
          args: [
            "INVOICE_AFTER_APPROVAL",
            {
              tenantId: TENANT,
              bookingIds: ["B-1"],
              groupBookingId: null,
              attachments: [file],
            },
          ],
        },
      ]);
    });

    it("an invoice to follow: the announcement", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        paymentRequest: { form: "pending" },
      });

      const outcome = await lifecycle.confirm(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal(table("pending"));
      expect(adapters.mail.calls).to.deep.equal([
        {
          op: "send",
          args: [
            "BOOKING_CONFIRMED_INVOICE_PENDING",
            { tenantId: TENANT, bookingIds: ["B-1"], groupBookingId: null },
          ],
        },
      ]);
    });

    it("a payment request that fails is recorded and sends nothing", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { payment: ["requestPayment"] },
      });

      const outcome = await lifecycle.confirm(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.provision skipped",
        "notify workflow.emit ok",
        "notify mail.FREE_BOOKING_CONFIRMATION skipped",
        "notify payment.requestPayment recorded",
        "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
        "notify mail.INVOICE_AFTER_APPROVAL skipped",
        "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
        "notify mail.NEW_BOOKING skipped",
      ]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  });

  it("leaves the workflow event out when a workflow action triggered the confirmation", async function () {
    const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

    const outcome = await lifecycle.confirm(TENANT, "B-1", {
      trigger: TRIGGER.WORKFLOW,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.provision skipped",
      "notify workflow.emit skipped",
      "notify mail.FREE_BOOKING_CONFIRMATION skipped",
      "notify payment.requestPayment ok",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.NEW_BOOKING skipped",
    ]);
    expect(adapters.workflow.calls).to.deep.equal([]);
  });

  it("mails the organizer of a ticket booking, reading the ticket off the bookable used", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        booking({
          bookableItems: [
            {
              bookableId: "ticket",
              amount: 1,
              _bookableUsed: { type: "ticket", eventId: "E1" },
            },
          ],
        }),
      ],
    });

    const outcome = await lifecycle.confirm(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome).at(-1)).to.equal("notify mail.NEW_BOOKING ok");
    expect(adapters.mail.calls.at(-1).args[1].bookingIds).to.deep.equal([
      "B-1",
    ]);
  });

  it("confirms a free ticket booking: grant, free booking confirmation and the organizer mail, no payment request", async function () {
    const { adapters, lifecycle } = lifecycleOver({
      bookings: [
        booking({
          priceEur: 0,
          bookableItems: [
            {
              bookableId: "ticket",
              amount: 1,
              _bookableUsed: { type: "ticket", eventId: "E1" },
            },
          ],
        }),
      ],
    });

    const outcome = await lifecycle.confirm(TENANT, "B-1", {
      trigger: TRIGGER.ADMIN,
    });

    expect(effectTable(outcome)).to.deep.equal([
      "persist store.save ok",
      "provision access.provision ok",
      "notify workflow.emit ok",
      "notify mail.FREE_BOOKING_CONFIRMATION ok",
      "notify payment.requestPayment skipped",
      "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
      "notify mail.INVOICE_AFTER_APPROVAL skipped",
      "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      "notify mail.NEW_BOOKING ok",
    ]);
    expect(adapters.store.rows.get("B-1").status).to.equal("confirmed");
    expect(adapters.payment.calls).to.deep.equal([]);
  });

  describe("the guard", function () {
    for (const status of [
      "payment_due",
      "confirmed",
      "rejected",
      "cancelled",
    ]) {
      it(`refuses to confirm a booking that is ${status}: 409 invalid_transition before any effect`, async function () {
        const { adapters, lifecycle } = lifecycleOver({
          bookings: [booking({ status })],
        });

        let error;
        try {
          await lifecycle.confirm(TENANT, "B-1", { trigger: TRIGGER.ADMIN });
        } catch (err) {
          error = err;
        }

        expect(error).to.be.instanceOf(ConflictError);
        expect(error.params).to.include({
          bookingId: "B-1",
          status,
          transition: "confirm",
        });
        expect(adapters.store.writes).to.deep.equal([]);
        expect(adapters.workflow.calls).to.deep.equal([]);
        expect(adapters.payment.calls).to.deep.equal([]);
      });
    }

    it("answers booking_not_found for a booking it does not know", async function () {
      const { lifecycle } = lifecycleOver({ bookings: [booking()] });

      let error;
      try {
        await lifecycle.confirm(TENANT, "B-2", { trigger: TRIGGER.ADMIN });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(NotFoundError);
    });

    it("demands a trigger", async function () {
      const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

      let error;
      try {
        await lifecycle.confirm(TENANT, "B-1", {});
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
      expect(error.message).to.match(/trigger/);
      expect(adapters.store.writes).to.deep.equal([]);
    });

    it("lets exactly one of two parallel confirmations through: one payment request, the other a 409", async function () {
      const { adapters, lifecycle } = lifecycleOver({ bookings: [booking()] });

      const results = await Promise.allSettled([
        lifecycle.confirm(TENANT, "B-1", { trigger: TRIGGER.ADMIN }),
        lifecycle.confirm(TENANT, "B-1", { trigger: TRIGGER.WORKFLOW }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).to.have.length(1);
      expect(rejected).to.have.length(1);
      expect(rejected[0].reason).to.be.instanceOf(ConflictError);
      expect(adapters.store.writes).to.deep.equal([
        { id: "B-1", status: "payment_due" },
      ]);
      expect(adapters.payment.calls).to.have.length(1);
    });
  });

  describe("the failure policy", function () {
    it("a grant that fails on a free confirmation is recorded; the booking is confirmed and told so", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking({ priceEur: 0 })],
        failOn: { access: ["provision"] },
      });

      const outcome = await lifecycle.confirm(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)).to.deep.equal([
        "persist store.save ok",
        "provision access.provision recorded",
        "notify workflow.emit ok",
        "notify mail.FREE_BOOKING_CONFIRMATION ok",
        "notify payment.requestPayment skipped",
        "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
        "notify mail.INVOICE_AFTER_APPROVAL skipped",
        "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
        "notify mail.NEW_BOOKING skipped",
      ]);
      expect(outcome.failure).to.equal(null);
      expect(adapters.store.rows.get("B-1").status).to.equal("confirmed");
      expect(adapters.store.calls.map((call) => call.op)).to.deep.equal([
        "save",
      ]);
    });

    it("a payment request that fails is recorded; the booking awaits payment", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { payment: ["requestPayment"] },
      });

      const outcome = await lifecycle.confirm(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome)[4]).to.equal(
        "notify payment.requestPayment recorded",
        "notify mail.PAYMENT_LINK_AFTER_APPROVAL skipped",
        "notify mail.INVOICE_AFTER_APPROVAL skipped",
        "notify mail.BOOKING_CONFIRMED_INVOICE_PENDING skipped",
      );
      expect(outcome.failure).to.equal(null);
      expect(adapters.store.rows.get("B-1").status).to.equal("payment_due");
    });

    it("an organizer mail that fails is recorded", async function () {
      const { lifecycle } = lifecycleOver({
        bookings: [
          booking({
            bookableItems: [
              {
                bookableId: "ticket",
                amount: 1,
                _bookableUsed: { type: "ticket", eventId: "E1" },
              },
            ],
          }),
        ],
        failOn: { mail: ["NEW_BOOKING"] },
      });

      const outcome = await lifecycle.confirm(TENANT, "B-1", {
        trigger: TRIGGER.ADMIN,
      });

      expect(effectTable(outcome).at(-1)).to.equal(
        "notify mail.NEW_BOOKING recorded",
      );
      expect(outcome.failure).to.equal(null);
    });

    it("a state write that fails aborts: nothing else runs, the booking stays requested", async function () {
      const { adapters, lifecycle } = lifecycleOver({
        bookings: [booking()],
        failOn: { store: ["save"] },
      });

      let error;
      try {
        await lifecycle.confirm(TENANT, "B-1", { trigger: TRIGGER.ADMIN });
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(LifecycleError);
      expect(error.transition).to.equal("confirm");
      expect(effectTable(error.outcome)).to.deep.equal([
        "persist store.save failed",
      ]);
      expect(error.outcome.booking.status).to.equal("requested");
      expect(adapters.workflow.calls).to.deep.equal([]);
      expect(adapters.payment.calls).to.deep.equal([]);
      expect(adapters.mail.calls).to.deep.equal([]);
    });
  });
});
