const { expect } = require("chai");

const {
  projectAccessPoint,
} = require("../src/commons/services/access/access-point-projection");
const { decide } = require("../src/commons/services/access/access-decision");
const { Booking } = require("../src/commons/entities/booking/booking");

describe("Access point projection", () => {
  /**
   * The decision for a booking of `booker-1` at the projected door, made for
   * the given user.
   */
  function decisionFor(accessPoint, { userId, canManage = false }) {
    const now = Date.now();
    const booking = new Booking({
      id: "booking-1",
      tenantId: "rostock",
      assignedUserId: "booker-1",
      isCommitted: true,
      isPayed: true,
      priceEur: 0,
      timeBegin: now - 60000,
      timeEnd: now + 60000,
      bookableItems: [{ bookableId: "room" }],
    });

    return decide(
      booking,
      [{ accessPoint, bookingContext: { isProvisioned: true } }],
      { userId, canManage, now },
    );
  }

  /**
   * A compartment as the resolver hands it over: the stored row of the locker
   * system under the compartment's own id.
   */
  function compartment(overrides = {}) {
    return {
      id: "loc-7:BK-99182",
      tenantId: "rostock",
      type: "locker",
      provider: "ifbs",
      externalId: "7",
      providerLocationId: "7",
      label: "Fahrradboxen Bahnhof",
      mode: "remote",
      config: {},
      validationRules: [],
      scanCode: "the-code",
      previousScanCodes: [],
      ...overrides,
    };
  }

  function storedDoor(overrides = {}) {
    return {
      id: "ap-7f3a",
      tenantId: "rostock",
      type: "door",
      provider: "nuki",
      externalId: "smartlock-1",
      providerLocationId: "account-1",
      label: "Werkstatt Nord",
      mode: "remote",
      config: { apiToken: "secret" },
      validationRules: [{ type: "qrScan" }],
      scanCode: "the-code",
      previousScanCodes: ["older-code"],
      ...overrides,
    };
  }

  describe("core fields", () => {
    it("projects an access point onto the fields both ways share", () => {
      const view = projectAccessPoint(storedDoor());

      expect(view).to.deep.equal({
        id: "ap-7f3a",
        tenantId: "rostock",
        type: "door",
        provider: "nuki",
        label: "Werkstatt Nord",
        mode: "remote",
        validationRuleTypes: ["qrScan"],
        capabilities: ["open", "close", "getStatus"],
      });
    });

    it("keeps the scan codes and the provider configuration server-side", () => {
      const view = projectAccessPoint(storedDoor());

      expect(view).to.not.have.any.keys(
        "scanCode",
        "previousScanCodes",
        "validationRules",
        "config",
        "externalId",
        "providerLocationId",
      );
    });

    it("answers a missing label with an empty string", () => {
      const view = projectAccessPoint(storedDoor({ label: undefined }));

      expect(view.label).to.equal("");
    });
  });

  describe("validationRuleTypes", () => {
    it("lists the types of the configured rules, without their configuration", () => {
      const view = projectAccessPoint(
        storedDoor({
          validationRules: [{ type: "qrScan", maxAgeMs: 5000 }],
        }),
      );

      expect(view.validationRuleTypes).to.deep.equal(["qrScan"]);
    });

    it("is empty for someone acting on a booking as the management", () => {
      const door = storedDoor();
      const view = projectAccessPoint(door, {
        decision: decisionFor(door, { userId: "manager-9", canManage: true }),
      });

      expect(view.validationRuleTypes).to.deep.equal([]);
    });

    it("demands the rules of the door from the booker of the booking", () => {
      const door = storedDoor();
      const view = projectAccessPoint(door, {
        decision: decisionFor(door, { userId: "booker-1", canManage: true }),
      });

      expect(view.validationRuleTypes).to.deep.equal(["qrScan"]);
    });

    it("reports the rules of the door where no decision was made", () => {
      const view = projectAccessPoint(storedDoor(), { decision: null });

      expect(view.validationRuleTypes).to.deep.equal(["qrScan"]);
    });

    it("demands nothing at a door the decision does not know", () => {
      const door = storedDoor();
      const view = projectAccessPoint(storedDoor({ id: "ap-other" }), {
        decision: decisionFor(door, { userId: "booker-1" }),
      });

      expect(view.validationRuleTypes).to.deep.equal([]);
    });

    it("reads the rules of a locker system like those of a door - a compartment asks for nothing only where its system has no rules", () => {
      const withRules = projectAccessPoint(
        compartment({ validationRules: [{ type: "qrScan" }] }),
      );
      const withoutRules = projectAccessPoint(
        compartment({ validationRules: [] }),
      );

      expect(withRules.validationRuleTypes).to.deep.equal(["qrScan"]);
      expect(withoutRules.validationRuleTypes).to.deep.equal([]);
    });

    it("is empty when the access point carries no rules", () => {
      const view = projectAccessPoint(storedDoor({ validationRules: [] }));

      expect(view.validationRuleTypes).to.deep.equal([]);
    });
  });

  describe("capabilities", () => {
    it("lists only the actions the user interface can offer", () => {
      const view = projectAccessPoint(storedDoor({ provider: "salto-ks" }));

      expect(view.capabilities).to.deep.equal(["open", "getStatus"]);
    });

    it("leaves unlatch out, because pulling the latch happens behind open", () => {
      const view = projectAccessPoint(storedDoor());

      expect(view.capabilities).to.not.include("unlatch");
    });

    it("is empty for a provider this server does not know", () => {
      const view = projectAccessPoint(storedDoor({ provider: "not-a-lock" }));

      expect(view.capabilities).to.deep.equal([]);
    });
  });

  describe("booking context", () => {
    it("adds the access window of the booking", () => {
      const view = projectAccessPoint(storedDoor(), {
        bookingContext: {
          accessFrom: 1755000000000,
          accessTo: 1755010800000,
          accessBuffer: { beforeMs: 900000, afterMs: 0 },
          isProvisioned: true,
          grant: {
            authorizationId: "auth-1",
            externalPrincipalId: "user-1",
            secret: null,
          },
          lastEvent: { success: true },
          provisionedAt: 1754000000000,
        },
      });

      expect(view).to.deep.equal({
        id: "ap-7f3a",
        tenantId: "rostock",
        type: "door",
        provider: "nuki",
        label: "Werkstatt Nord",
        mode: "remote",
        validationRuleTypes: ["qrScan"],
        capabilities: ["open", "close", "getStatus"],
        accessFrom: 1755000000000,
        accessTo: 1755010800000,
        accessBuffer: { beforeMs: 900000, afterMs: 0 },
        isProvisioned: true,
      });
    });

    it("answers an unknown access window with null and no buffer", () => {
      const view = projectAccessPoint(storedDoor(), { bookingContext: {} });

      expect(view.accessFrom).to.be.null;
      expect(view.accessTo).to.be.null;
      expect(view.accessBuffer).to.deep.equal({ beforeMs: 0, afterMs: 0 });
      expect(view.isProvisioned).to.be.false;
    });

    it("projects a granted compartment under its opaque id, with the compartment the person looks for and the provider's booking id", () => {
      const view = projectAccessPoint(compartment(), {
        bookingContext: {
          externalBookingId: "BK-99182",
          compartment: "62100103",
          accessFrom: 1755000000000,
          accessTo: 1755010800000,
          accessBuffer: { beforeMs: 0, afterMs: 0 },
          isProvisioned: true,
          grant: { authorizationId: "BK-99182" },
          revokedAt: null,
        },
      });

      expect(view).to.deep.equal({
        id: "loc-7:BK-99182",
        tenantId: "rostock",
        type: "locker",
        provider: "ifbs",
        label: "Fahrradboxen Bahnhof",
        mode: "remote",
        validationRuleTypes: [],
        capabilities: ["open"],
        accessFrom: 1755000000000,
        accessTo: 1755010800000,
        accessBuffer: { beforeMs: 0, afterMs: 0 },
        isProvisioned: true,
        externalBookingId: "BK-99182",
        compartment: "62100103",
      });
    });

    it("projects a held compartment as not provisioned - provisioned is the grant, not the existence", () => {
      const view = projectAccessPoint(compartment({ id: "loc-7:hold" }), {
        bookingContext: {
          externalBookingId: null,
          compartment: "62100103",
          isProvisioned: false,
          grant: null,
        },
      });

      expect(view).to.include({
        id: "loc-7:hold",
        isProvisioned: false,
        externalBookingId: null,
        compartment: "62100103",
      });
    });

    it("offers nothing to do at a compartment of a locker system that mails its own code", () => {
      const view = projectAccessPoint(
        compartment({ id: "size-s:process-1", provider: "pareva" }),
        { bookingContext: { compartment: null, isProvisioned: true } },
      );

      expect(view.capabilities).to.deep.equal([]);
      expect(view.compartment).to.be.null;
    });

    it("leaves the external booking id off a door", () => {
      const view = projectAccessPoint(storedDoor(), {
        bookingContext: { externalBookingId: "BK-99182" },
      });

      expect(view).to.not.have.property("externalBookingId");
    });

    it("does not carry booking fields when there is no booking", () => {
      const view = projectAccessPoint(storedDoor());

      expect(view).to.not.have.any.keys(
        "accessFrom",
        "accessTo",
        "accessBuffer",
        "isProvisioned",
        "externalBookingId",
        "compartment",
      );
    });
  });
});
