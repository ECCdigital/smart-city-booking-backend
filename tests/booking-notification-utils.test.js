const { expect } = require("chai");
const {
  MAX_BOOKING_NOTIFICATION_RECIPIENTS,
  isValidBookingNotificationRecipient,
  validateBookingNotificationRecipients,
  sanitizeBookingNotificationRecipients,
} = require("../src/commons/utilities/booking-notification-utils");
const Membership = require("../src/commons/entities/tenant/membership");
const { ValidationError } = require("../src/errors/ValidationError");

describe("booking-notification-utils", () => {
  describe("isValidBookingNotificationRecipient", () => {
    it("accepts a valid user recipient", () => {
      expect(
        isValidBookingNotificationRecipient({
          type: "user",
          value: "leitung@stadt.de",
        }),
      ).to.be.true;
    });

    it("accepts a valid role recipient", () => {
      expect(
        isValidBookingNotificationRecipient({
          type: "role",
          value: "fachbereichsleitung",
        }),
      ).to.be.true;
    });

    it("accepts a valid email recipient with label", () => {
      expect(
        isValidBookingNotificationRecipient({
          type: "email",
          value: "sekretariat@stadt.de",
          label: "Sekretariat",
        }),
      ).to.be.true;
    });

    it("rejects unknown types", () => {
      expect(isValidBookingNotificationRecipient({ type: "group", value: "x" }))
        .to.be.false;
    });

    it("rejects empty values", () => {
      expect(isValidBookingNotificationRecipient({ type: "email", value: "" }))
        .to.be.false;
      expect(
        isValidBookingNotificationRecipient({ type: "role", value: "   " }),
      ).to.be.false;
    });

    it("rejects invalid email addresses for email and user types", () => {
      expect(
        isValidBookingNotificationRecipient({
          type: "email",
          value: "not-an-email",
        }),
      ).to.be.false;
      expect(
        isValidBookingNotificationRecipient({
          type: "user",
          value: "not-an-email",
        }),
      ).to.be.false;
    });

    it("rejects non-object entries", () => {
      expect(isValidBookingNotificationRecipient(null)).to.be.false;
      expect(isValidBookingNotificationRecipient("mail@stadt.de")).to.be.false;
      expect(isValidBookingNotificationRecipient(["user"])).to.be.false;
    });

    it("rejects non-string labels", () => {
      expect(
        isValidBookingNotificationRecipient({
          type: "email",
          value: "mail@stadt.de",
          label: 42,
        }),
      ).to.be.false;
    });
  });

  describe("validateBookingNotificationRecipients", () => {
    it("accepts undefined, null and empty arrays", () => {
      expect(validateBookingNotificationRecipients(undefined)).to.be.true;
      expect(validateBookingNotificationRecipients(null)).to.be.true;
      expect(validateBookingNotificationRecipients([])).to.be.true;
    });

    it("rejects non-array values", () => {
      expect(validateBookingNotificationRecipients("x")).to.equal("validate");
    });

    it("rejects lists above the maximum size", () => {
      const tooMany = Array.from(
        { length: MAX_BOOKING_NOTIFICATION_RECIPIENTS + 1 },
        (_, i) => ({ type: "email", value: `mail${i}@stadt.de` }),
      );
      expect(validateBookingNotificationRecipients(tooMany)).to.equal(
        "maxItems",
      );
    });

    it("rejects lists containing invalid entries", () => {
      expect(
        validateBookingNotificationRecipients([
          { type: "email", value: "mail@stadt.de" },
          { type: "email", value: "invalid" },
        ]),
      ).to.equal("validate");
    });
  });

  describe("sanitizeBookingNotificationRecipients", () => {
    it("trims and lowercases user and email values", () => {
      const result = sanitizeBookingNotificationRecipients([
        { type: "user", value: "  Leitung@Stadt.DE " },
        { type: "email", value: "Sekretariat@Stadt.de", label: "  Büro  " },
      ]);

      expect(result[0]).to.deep.equal({
        type: "user",
        value: "leitung@stadt.de",
        label: "",
      });
      expect(result[1]).to.deep.equal({
        type: "email",
        value: "sekretariat@stadt.de",
        label: "Büro",
      });
    });

    it("keeps role values case-sensitive but trimmed", () => {
      const result = sanitizeBookingNotificationRecipients([
        { type: "role", value: " RoleId-123 " },
      ]);
      expect(result[0].value).to.equal("RoleId-123");
    });
  });

  describe("Membership entity integration", () => {
    it("creates a membership with valid recipients", () => {
      const membership = Membership.create({
        userId: "user@stadt.de",
        tenantId: "tenant-1",
        source: "manually",
        bookingNotificationRecipients: [
          { type: "email", value: "chef@stadt.de" },
        ],
      });

      expect(membership.bookingNotificationRecipients).to.have.length(1);
    });

    it("defaults to an empty recipient list", () => {
      const membership = Membership.create({
        userId: "user@stadt.de",
        tenantId: "tenant-1",
        source: "manually",
      });

      expect(membership.bookingNotificationRecipients).to.deep.equal([]);
    });

    it("rejects invalid recipients on validation", () => {
      expect(() =>
        Membership.create({
          userId: "user@stadt.de",
          tenantId: "tenant-1",
          source: "manually",
          bookingNotificationRecipients: [{ type: "email", value: "no-email" }],
        }),
      ).to.throw(ValidationError);
    });

    it("rejects more than the allowed number of recipients", () => {
      const tooMany = Array.from(
        { length: MAX_BOOKING_NOTIFICATION_RECIPIENTS + 1 },
        (_, i) => ({ type: "email", value: `mail${i}@stadt.de` }),
      );

      expect(() =>
        Membership.create({
          userId: "user@stadt.de",
          tenantId: "tenant-1",
          source: "manually",
          bookingNotificationRecipients: tooMany,
        }),
      ).to.throw(ValidationError);
    });
  });
});
