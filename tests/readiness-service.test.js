/**
 * The readiness check (glossary "Bereitschafts-Check", supervision spec §7):
 * one criterion per rule, computed from the loaded data of a tenant, never
 * stored. The rules are tested at their value over plain records; the
 * loader over the stubbed managers.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  computeReadiness,
  evaluateReadiness,
} = require("../src/commons/services/supervision/readiness-service");

const NOW = new Date("2026-09-21T10:00:00.000Z");

function tenant(overrides = {}) {
  return {
    id: "t1",
    name: "Stadt Musterhausen",
    contactName: "Erika Muster",
    mail: "info@example.test",
    useInstanceMail: true,
    applications: [],
    ...overrides,
  };
}

function instance(overrides = {}) {
  return {
    mailEnabled: true,
    noreplyMail: "noreply@example.test",
    noreplyDisplayName: "Plattform",
    noreplyHost: "smtp.example.test",
    noreplyPort: 587,
    noreplyUser: "noreply",
    noreplyPassword: { iv: "x", content: "y" },
    ...overrides,
  };
}

function bookable(overrides = {}) {
  return {
    id: "b1",
    title: "Sporthalle",
    type: "room",
    isPublic: true,
    isBookable: true,
    priceCategories: [{ priceEur: 0 }],
    externalProviders: [],
    permittedUsers: [],
    permittedRoles: [],
    isOpeningHoursRelated: false,
    openingHours: [],
    isTimePeriodRelated: false,
    timePeriods: [],
    isBlockPeriodRelated: false,
    blockPeriods: [],
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: "e1",
    isPublic: true,
    externalBookingUrl: "",
    attendees: { free: true, priceCategories: [] },
    information: {
      name: "Sommerfest",
      startDate: "2026-10-03",
      startTime: "14:00",
      endDate: "2026-10-03",
      endTime: "18:00",
    },
    ...overrides,
  };
}

function criterion(result, key) {
  return result.criteria.find((entry) => entry.key === key);
}

function evaluate(overrides = {}) {
  return evaluateReadiness({
    tenant: tenant(),
    instance: instance(),
    bookables: [],
    events: [],
    now: NOW,
    ...overrides,
  });
}

describe("readiness check", function () {
  afterEach(function () {
    sinon.restore();
  });

  describe("contact", function () {
    it("is fulfilled with name, contact person and a valid mail", function () {
      const result = evaluate();
      expect(criterion(result, "contact").state).to.equal("fulfilled");
    });

    it("is missing without a contact person or with a malformed mail", function () {
      const noPerson = evaluate({ tenant: tenant({ contactName: "  " }) });
      expect(criterion(noPerson, "contact").state).to.equal("missing");
      expect(criterion(noPerson, "contact").hint).to.contain("Kontaktperson");

      const badMail = evaluate({ tenant: tenant({ mail: "not-a-mail" }) });
      expect(criterion(badMail, "contact").state).to.equal("missing");
      expect(criterion(badMail, "contact").hint).to.contain("E-Mail");
    });

    it("does not ask for phone, website or address", function () {
      const result = evaluate({
        tenant: tenant({ phone: "", website: "", location: "" }),
      });
      expect(criterion(result, "contact").state).to.equal("fulfilled");
    });
  });

  describe("legal documents", function () {
    it("never opens an item, with or without documents", function () {
      const without = evaluate({ tenant: tenant({ legalDocuments: [] }) });
      expect(criterion(without, "legal").state).to.equal("not_required");
    });
  });

  describe("offers", function () {
    it("is missing without a bookable or a current event that wants to be public", function () {
      const result = evaluate({
        bookables: [bookable({ isPublic: false })],
        events: [
          event({ isPublic: false }),
          event({
            id: "past",
            information: { startDate: "2020-01-01", endDate: "2020-01-01" },
          }),
        ],
      });
      expect(criterion(result, "offers").state).to.equal("missing");
    });

    it("is fulfilled by one public bookable, whatever its review status", function () {
      const result = evaluate({
        bookables: [bookable({ review: { status: "rejected" } })],
      });
      expect(criterion(result, "offers").state).to.equal("fulfilled");
    });

    it("is fulfilled by an ongoing public event", function () {
      const result = evaluate({
        events: [
          event({
            information: {
              startDate: "2026-09-21",
              startTime: "08:00",
              endDate: "2026-09-21",
              endTime: "20:00",
            },
          }),
        ],
      });
      expect(criterion(result, "offers").state).to.equal("fulfilled");
    });
  });

  describe("schedule", function () {
    it("is not required without relevant offers", function () {
      const result = evaluate({ bookables: [bookable({ isPublic: false })] });
      expect(criterion(result, "schedule").state).to.equal("not_required");
    });

    it("accepts a bookable without time restrictions and one with configured ones", function () {
      const result = evaluate({
        bookables: [
          bookable({ id: "free" }),
          bookable({
            id: "hours",
            isOpeningHoursRelated: true,
            openingHours: [
              { weekdays: [1, 2], startTime: "08:00", endTime: "18:00" },
            ],
          }),
          bookable({
            id: "periods",
            isTimePeriodRelated: true,
            timePeriods: [
              { weekdays: [3], startTime: "10:00", endTime: "12:00" },
            ],
          }),
        ],
      });
      expect(criterion(result, "schedule").state).to.equal("fulfilled");
    });

    it("names every public bookable whose enabled restriction has no entries", function () {
      const result = evaluate({
        bookables: [
          bookable({ id: "hours", isOpeningHoursRelated: true }),
          bookable({
            id: "periods",
            title: "Kursraum",
            isTimePeriodRelated: true,
          }),
          bookable({
            id: "private",
            isPublic: false,
            isOpeningHoursRelated: true,
          }),
        ],
      });
      const schedule = criterion(result, "schedule");
      expect(schedule.state).to.equal("missing");
      expect(schedule.offers).to.deep.equal([
        { offerType: "bookable", offerId: "hours", title: "Sporthalle" },
        { offerType: "bookable", offerId: "periods", title: "Kursraum" },
      ]);
    });

    it("names a public upcoming event without a valid period, past events left out", function () {
      const result = evaluate({
        events: [
          event({ id: "ok" }),
          event({
            id: "no-start",
            information: { name: "Ohne Termin", startDate: null },
          }),
          event({
            id: "inverted",
            information: {
              name: "Verdreht",
              startDate: "2026-11-02",
              endDate: "2026-11-01",
            },
          }),
          event({
            id: "past",
            information: { startDate: "2019-01-01", endDate: null },
          }),
        ],
      });
      const schedule = criterion(result, "schedule");
      expect(schedule.state).to.equal("missing");
      expect(schedule.offers).to.deep.equal([
        { offerType: "event", offerId: "no-start", title: "Ohne Termin" },
        { offerType: "event", offerId: "inverted", title: "Verdreht" },
      ]);
    });
  });

  describe("payment", function () {
    const paid = (overrides = {}) =>
      bookable({ priceCategories: [{ priceEur: 12.5 }], ...overrides });
    const giroCockpit = {
      type: "payment",
      id: "giroCockpit",
      active: true,
      paymentMerchantId: "m",
      paymentProjectId: "p",
      paymentSecret: "s",
    };
    const invoice = { type: "payment", id: "invoice", active: true };

    it("is not required when every relevant offer is free", function () {
      const result = evaluate({
        bookables: [
          bookable(),
          bookable({
            id: "b2",
            isPublic: false,
            priceCategories: [{ priceEur: 9 }],
          }),
        ],
        events: [event()],
      });
      expect(criterion(result, "payment").state).to.equal("not_required");
    });

    it("is missing for a paid bookable without an active payment app", function () {
      const result = evaluate({ bookables: [paid()] });
      const payment = criterion(result, "payment");
      expect(payment.state).to.equal("missing");
      expect(payment.offers).to.deep.equal([
        { offerType: "bookable", offerId: "b1", title: "Sporthalle" },
      ]);
    });

    it("is fulfilled by a complete online payment app", function () {
      const result = evaluate({
        tenant: tenant({ applications: [giroCockpit] }),
        bookables: [paid()],
      });
      expect(criterion(result, "payment").state).to.equal("fulfilled");
    });

    it("treats an active app with missing credentials as not set up", function () {
      const result = evaluate({
        tenant: tenant({
          applications: [{ ...giroCockpit, paymentSecret: "" }],
        }),
        bookables: [paid()],
      });
      expect(criterion(result, "payment").state).to.equal("missing");
    });

    it("counts an unrestricted invoice", function () {
      const result = evaluate({
        tenant: tenant({ applications: [invoice] }),
        bookables: [paid()],
      });
      expect(criterion(result, "payment").state).to.equal("fulfilled");
    });

    it("does not count an invoice limited to some users for an offer open to everyone", function () {
      const result = evaluate({
        tenant: tenant({
          applications: [{ ...invoice, permittedRoles: ["members"] }],
        }),
        bookables: [
          paid(),
          paid({ id: "closed", permittedRoles: ["members"] }),
        ],
      });
      const payment = criterion(result, "payment");
      expect(payment.state).to.equal("missing");
      expect(payment.offers.map((offer) => offer.offerId)).to.deep.equal([
        "b1",
      ]);
    });

    it("treats a dynamic external price as paid, even at a zero price", function () {
      const result = evaluate({
        bookables: [
          bookable({
            externalProviders: [
              { active: true, provider: "ifbs", handles: ["pricing"] },
            ],
          }),
        ],
      });
      expect(criterion(result, "payment").state).to.equal("missing");
    });

    it("needs no payment for free or externally booked events", function () {
      const result = evaluate({
        events: [
          event({ id: "free" }),
          event({
            id: "external",
            externalBookingUrl: "https://tickets.example.test",
            attendees: { free: false, priceCategories: [{ priceEur: 20 }] },
          }),
        ],
      });
      expect(criterion(result, "payment").state).to.equal("not_required");
    });

    it("names a paid platform event without payment", function () {
      const result = evaluate({
        events: [
          event({
            attendees: { free: false, priceCategories: [{ priceEur: 20 }] },
          }),
        ],
      });
      const payment = criterion(result, "payment");
      expect(payment.state).to.equal("missing");
      expect(payment.offers).to.deep.equal([
        { offerType: "event", offerId: "e1", title: "Sommerfest" },
      ]);
    });
  });

  describe("mail", function () {
    const ownAccount = {
      useInstanceMail: false,
      noreplyMail: "buchung@musterhausen.test",
      noreplyDisplayName: "Stadt Musterhausen",
      noreplyHost: "smtp.musterhausen.test",
      noreplyPort: 465,
      noreplyUser: "buchung",
      noreplyPassword: { iv: "a", content: "b" },
    };

    it("is missing while the instance has mail switched off, whatever the tenant configured", function () {
      const result = evaluate({
        tenant: tenant(ownAccount),
        instance: instance({ mailEnabled: false }),
      });
      const mail = criterion(result, "mail");
      expect(mail.state).to.equal("missing");
      expect(mail.hint).to.contain("instanzweit");
    });

    it("is fulfilled over the instance account when the tenant uses the instance mail", function () {
      const mail = criterion(evaluate(), "mail");
      expect(mail.state).to.equal("fulfilled");
      expect(mail.transport).to.equal("instance");
    });

    it("is fulfilled over the tenant's complete account without instance credentials", function () {
      const result = evaluate({
        tenant: tenant(ownAccount),
        instance: instance({ noreplyHost: "", noreplyPassword: null }),
      });
      const mail = criterion(result, "mail");
      expect(mail.state).to.equal("fulfilled");
      expect(mail.transport).to.equal("tenant");
    });

    it("falls back to the instance for an incomplete tenant account and judges that", function () {
      const incomplete = tenant({ ...ownAccount, noreplyPassword: null });
      const withFallback = criterion(evaluate({ tenant: incomplete }), "mail");
      expect(withFallback.state).to.equal("fulfilled");
      expect(withFallback.transport).to.equal("instance");

      const noFallback = criterion(
        evaluate({
          tenant: incomplete,
          instance: instance({ noreplyPassword: null }),
        }),
        "mail",
      );
      expect(noFallback.state).to.equal("missing");
      expect(noFallback.transport).to.equal("instance");
    });

    it("never carries credentials", function () {
      const mail = criterion(evaluate({ tenant: tenant(ownAccount) }), "mail");
      expect(Object.keys(mail)).to.have.members([
        "key",
        "state",
        "hint",
        "offers",
        "transport",
      ]);
      expect(JSON.stringify(mail)).to.not.contain("smtp.musterhausen.test");
    });
  });

  describe("computeReadiness", function () {
    const TenantManager = require("../src/commons/data-managers/tenant-manager");
    const InstanceManager = require("../src/commons/data-managers/instance-manager");
    const {
      BookableManager,
    } = require("../src/commons/data-managers/bookable-manager");
    const EventManager = require("../src/commons/data-managers/event-manager");

    it("reads the tenant, the instance and every offer of the tenant and lists the six criteria", async function () {
      sinon.stub(TenantManager, "getTenant").resolves(tenant());
      sinon.stub(InstanceManager, "getInstance").resolves(instance());
      sinon
        .stub(BookableManager, "getBookables")
        .withArgs("t1")
        .resolves([bookable({ priceCategories: [{ priceEur: 5 }] })]);
      sinon.stub(EventManager, "getEvents").withArgs("t1").resolves([]);

      const result = await computeReadiness("t1", { now: NOW });

      expect(result.checkedAt).to.equal("2026-09-21T10:00:00.000Z");
      expect(
        result.criteria.map((entry) => [entry.key, entry.state]),
      ).to.deep.equal([
        ["contact", "fulfilled"],
        ["legal", "not_required"],
        ["offers", "fulfilled"],
        ["schedule", "fulfilled"],
        ["payment", "missing"],
        ["mail", "fulfilled"],
      ]);
    });

    it("answers not found for an unknown tenant", async function () {
      sinon.stub(TenantManager, "getTenant").resolves(null);
      let error;
      try {
        await computeReadiness("nope");
      } catch (err) {
        error = err;
      }
      expect(error?.statusCode).to.equal(404);
      expect(error?.code).to.equal("tenant_not_found");
    });
  });
});
