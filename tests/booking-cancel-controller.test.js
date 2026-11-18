/**
 * The direct cancellation of the signed-in booker's own booking,
 * `POST /api/:tenant/bookings/:id/cancel` (glossary "Storno", trigger
 * customer): the controller over a lifecycle on the in-memory adapters,
 * the booking manager answering the stored rows under the reach `own`.
 * Checked are the answer, the stored booking and the documents and mails
 * that went out.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  BookingController,
} = require("../src/platform/api/controllers/booking-controller");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  bookingLifecycle,
  createBookingLifecycle,
} = require("../src/commons/services/booking-lifecycle/booking-lifecycle");
const { inMemoryAdapters } = require("./helpers/in-memory-lifecycle-adapters");

const TENANT = "tenant-1";
const DAY = 24 * 60 * 60 * 1000;

function booking(overrides = {}) {
  return {
    id: "B-1",
    tenantId: TENANT,
    assignedUserId: "erika",
    status: "confirmed",
    priceEur: 40,
    timeBegin: Date.now() + 10 * DAY,
    timeEnd: Date.now() + 10 * DAY + 2 * 60 * 60 * 1000,
    paymentProvider: "giroCockpit",
    mail: "erika@example.test",
    name: "Erika Muster",
    attachments: [],
    hooks: [],
    cancellationPolicy: { userCancellable: true, contactHint: "" },
    bookableItems: [
      { bookableId: "room", amount: 1, _bookableUsed: { type: "room" } },
    ],
    ...overrides,
  };
}

const BANK_DETAILS = {
  accountHolder: "Erika Muster",
  iban: "DE89 3704 0044 0532 0130 00",
  bic: "COBADEFFXXX",
  bankName: "Commerzbank",
};

function response() {
  return {
    status: sinon.stub().returnsThis(),
    send: sinon.stub().returnsThis(),
    sendStatus: sinon.stub().returnsThis(),
    json: sinon.stub().returnsThis(),
  };
}

/** The status and the JSON body of the answer. */
function answerOf(res) {
  if (res.sendStatus.called) {
    return { status: res.sendStatus.firstCall.args[0], body: undefined };
  }
  const body = res.json.called
    ? res.json.firstCall.args[0]
    : res.send.firstCall?.args[0];
  return { status: res.status.firstCall.args[0], body };
}

describe("BookingController.cancelBooking", function () {
  let sandbox;
  let adapters;

  /** The seam over these bookings, the default lifecycle routed to it. */
  function seed(...bookings) {
    adapters = inMemoryAdapters({ bookings });
    const lifecycle = createBookingLifecycle(adapters);
    sandbox.stub(bookingLifecycle, "cancel").callsFake(lifecycle.cancel);
    sandbox
      .stub(BookingManager, "getBooking")
      .callsFake(async (id, tenantId, scope) => {
        const row = adapters.store.rows.get(id);
        const inReach =
          row &&
          row.tenantId === tenantId &&
          (scope.reach === "any" || row.assignedUserId === scope.userId);
        return inReach ? new Booking(JSON.parse(JSON.stringify(row))) : null;
      });
  }

  /** Cancels as `userId` with the reach the route decided for them. */
  async function cancel(body, { userId = "erika", reach = "own", id } = {}) {
    const res = response();
    await BookingController.cancelBooking(
      {
        params: { tenant: TENANT, id: id || "B-1" },
        body,
        user: { id: userId },
        reach,
        principal: { userId },
      },
      res,
    );
    return answerOf(res);
  }

  function stored(id = "B-1") {
    return adapters.store.rows.get(id);
  }

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("cancels the own booking", function () {
    it("a confirmed booking: cancelled, the trimmed reason, the refund audit of the booker, the document and the cancel mail", async function () {
      seed(booking());

      const answer = await cancel({ reason: "  Termin verschoben  " });

      expect(answer).to.deep.equal({ status: 200, body: undefined });
      expect(stored()).to.include({
        status: "cancelled",
        rejectionReason: "Termin verschoben",
      });
      expect(stored().cancellationRefund).to.include({
        origin: "user",
        cancelledByUserId: "erika",
        cancelledFrom: "confirmed",
      });
      expect(adapters.access.calls.map((call) => call.op)).to.deep.equal([
        "revoke",
      ]);
      expect(adapters.documents.calls[0].args[0].type).to.equal("cancellation");
      expect(adapters.workflow.calls[0].args[2]).to.equal("onReject");
      expect(adapters.mail.calls.map((call) => call.args[0])).to.deep.equal([
        "BOOKING_CANCEL",
      ]);
    });

    it("a booking awaiting payment: cancelled", async function () {
      seed(booking({ status: "payment_due" }));

      const answer = await cancel({ reason: "Doch nicht" });

      expect(answer.status).to.equal(200);
      expect(stored().status).to.equal("cancelled");
      expect(stored().cancellationRefund.cancelledByUserId).to.equal("erika");
    });

    it("a request: rejected, with the cancel mail rather than the rejection", async function () {
      seed(booking({ status: "requested" }));

      const answer = await cancel({ reason: "Doch nicht" });

      expect(answer.status).to.equal(200);
      expect(stored().status).to.equal("rejected");
      expect(stored().cancellationRefund.origin).to.equal("user");
      expect(adapters.mail.calls.map((call) => call.args[0])).to.deep.equal([
        "BOOKING_CANCEL",
      ]);
    });

    it("hands the bank details of a paid booking to the cancellation document", async function () {
      seed(booking());

      await cancel({ reason: "Krank", bankDetails: BANK_DETAILS });

      const { options } = adapters.documents.calls[0].args[0];
      expect(options.bankDetails).to.include({
        accountHolder: "Erika Muster",
        bankName: "Commerzbank",
      });
    });

    it("drops the bank details of an unpaid booking and cancels all the same", async function () {
      seed(booking({ status: "payment_due" }));

      const answer = await cancel({
        reason: "Krank",
        bankDetails: BANK_DETAILS,
      });

      expect(answer.status).to.equal(200);
      expect(stored().status).to.equal("cancelled");
      const { options } = adapters.documents.calls[0].args[0];
      expect(options.bankDetails).to.equal(undefined);
    });

    it("leaves an open cancellation request on the booking", async function () {
      seed(
        booking({
          hooks: [
            { id: "hook-1", type: "REJECT", payload: { reason: "per Mail" } },
          ],
        }),
      );

      await cancel({ reason: "Direkt" });

      expect(stored().status).to.equal("cancelled");
      expect(stored().hooks.map((hook) => hook.id)).to.deep.equal(["hook-1"]);
    });
  });

  describe("400 reason_required, before anything else", function () {
    for (const [label, body] of [
      ["without a reason", {}],
      ["with an empty reason", { reason: "" }],
      ["with a reason of blanks", { reason: "   " }],
      ["without a body", undefined],
    ]) {
      it(label, async function () {
        seed(booking());

        const answer = await cancel(body);

        expect(answer.status).to.equal(400);
        expect(answer.body.code).to.equal("reason_required");
        expect(stored().status).to.equal("confirmed");
        expect(BookingManager.getBooking.called).to.equal(false);
      });
    }

    it("for a booking of someone else too, which stays as it was", async function () {
      seed(booking({ assignedUserId: "max" }));

      const answer = await cancel({ reason: " " });

      expect(answer.status).to.equal(400);
      expect(answer.body.code).to.equal("reason_required");
      expect(stored().status).to.equal("confirmed");
    });
  });

  describe("404 booking_not_found", function () {
    it("for a booking of someone else", async function () {
      seed(booking({ assignedUserId: "max" }));

      const answer = await cancel({ reason: "Weg damit" });

      expect(answer.status).to.equal(404);
      expect(answer.body.code).to.equal("booking_not_found");
      expect(stored().status).to.equal("confirmed");
    });

    it("for a booking of someone else, to the administration as well", async function () {
      seed(booking({ assignedUserId: "max" }));

      const answer = await cancel(
        { reason: "Weg damit" },
        { userId: "admin-1", reach: "any" },
      );

      expect(answer.status).to.equal(404);
      expect(answer.body.code).to.equal("booking_not_found");
      expect(stored().status).to.equal("confirmed");
      expect(BookingManager.getBooking.firstCall.args[2]).to.deep.equal({
        reach: "own",
        userId: "admin-1",
      });
    });

    it("for a booking that is not there", async function () {
      seed(booking());

      const answer = await cancel({ reason: "Weg damit" }, { id: "B-404" });

      expect(answer.status).to.equal(404);
      expect(answer.body.code).to.equal("booking_not_found");
    });
  });

  describe("403 booking_user_cancellation_disabled", function () {
    const locked = {
      cancellationPolicy: { userCancellable: false, contactHint: "Ruf an" },
    };

    it("for an own booking whose policy is not user-cancellable", async function () {
      seed(booking(locked));

      const answer = await cancel({ reason: "Weg damit" });

      expect(answer.status).to.equal(403);
      expect(answer.body.code).to.equal("booking_user_cancellation_disabled");
      expect(stored().status).to.equal("confirmed");
    });

    it("for the own booking of someone in the administration as well", async function () {
      seed(booking({ ...locked, assignedUserId: "admin-1" }));

      const answer = await cancel(
        { reason: "Weg damit" },
        { userId: "admin-1", reach: "any" },
      );

      expect(answer.status).to.equal(403);
      expect(answer.body.code).to.equal("booking_user_cancellation_disabled");
      expect(stored().status).to.equal("confirmed");
    });
  });

  describe("409 invalid_transition", function () {
    for (const [label, status] of [
      ["cancelled already", "cancelled"],
      ["expired: turned down by the system", "rejected"],
    ]) {
      it(`for a booking that is ${label}`, async function () {
        seed(booking({ status, rejectionReason: "vorher" }));

        const answer = await cancel({ reason: "Nochmal" });

        expect(answer.status).to.equal(409);
        expect(answer.body.code).to.equal("invalid_transition");
        expect(stored()).to.include({ status, rejectionReason: "vorher" });
        expect(adapters.mail.calls).to.deep.equal([]);
      });
    }
  });
});
