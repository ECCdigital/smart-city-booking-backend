const assert = require("assert");
const sinon = require("sinon");
const {
  CustomFieldService,
} = require("../src/commons/services/custom-field/custom-field-service");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const MailDataService = require("../src/commons/mail-service/mail-data.service");
// Registers the Handlebars helpers/partials the booking-details snippet uses.
require("../src/commons/mail-service/mail-service");
const {
  renderSnippet,
} = require("../src/commons/mail-service/templates/template-loader");

function checkoutField(overrides = {}) {
  return {
    id: "field-a",
    caption: "Anzahl Personen",
    inputType: "string",
    usageOptions: { context: "checkout", showInMail: true },
    ...overrides,
  };
}

describe("CustomFieldService.normalizeUsageOptions (showInMail)", () => {
  it("keeps showInMail on checkout fields", () => {
    const definition = checkoutField();

    CustomFieldService.normalizeUsageOptions(definition);

    assert.strictEqual(definition.usageOptions.showInMail, true);
  });

  it("clears showInMail on non-checkout fields", () => {
    for (const context of ["catalog", "none"]) {
      const definition = checkoutField({
        usageOptions: { context, showInMail: true },
      });

      CustomFieldService.normalizeUsageOptions(definition);

      assert.strictEqual(definition.usageOptions.showInMail, false);
    }
  });

  it("coerces missing or non-boolean showInMail to false", () => {
    for (const showInMail of [undefined, null, "true", 1]) {
      const definition = checkoutField({
        usageOptions: { context: "checkout", showInMail },
      });

      CustomFieldService.normalizeUsageOptions(definition);

      assert.strictEqual(definition.usageOptions.showInMail, false);
    }
  });
});

describe("CustomFieldService.formatValueForDisplay", () => {
  it("returns null for empty values regardless of inputType", () => {
    for (const inputType of [
      "string",
      "text",
      "numeric",
      "boolean",
      "select",
    ]) {
      for (const value of [null, undefined, ""]) {
        const result = CustomFieldService.formatValueForDisplay(
          checkoutField({ inputType }),
          value,
        );

        assert.strictEqual(result, null);
      }
    }
  });

  it("formats boolean values as Ja/Nein", () => {
    const definition = checkoutField({ inputType: "boolean" });

    assert.strictEqual(
      CustomFieldService.formatValueForDisplay(definition, true),
      "Ja",
    );
    assert.strictEqual(
      CustomFieldService.formatValueForDisplay(definition, false),
      "Nein",
    );
  });

  it("formats select values as the caption of the matching option", () => {
    const definition = checkoutField({
      inputType: "select",
      options: [
        { value: "opt-a", caption: "Option A" },
        { value: "opt-b", caption: "Option B" },
      ],
    });

    assert.strictEqual(
      CustomFieldService.formatValueForDisplay(definition, "opt-b"),
      "Option B",
    );
  });

  it("keeps plain string select options as-is", () => {
    const definition = checkoutField({
      inputType: "select",
      options: ["Klein", "Groß"],
    });

    assert.strictEqual(
      CustomFieldService.formatValueForDisplay(definition, "Groß"),
      "Groß",
    );
  });

  it("falls back to the raw value when the select option was deleted", () => {
    const definition = checkoutField({
      inputType: "select",
      options: [{ value: "opt-a", caption: "Option A" }],
    });

    assert.strictEqual(
      CustomFieldService.formatValueForDisplay(definition, "opt-gone"),
      "opt-gone",
    );
  });

  it("formats numeric values as strings, keeping 0 visible", () => {
    const definition = checkoutField({ inputType: "numeric" });

    assert.strictEqual(
      CustomFieldService.formatValueForDisplay(definition, 0),
      "0",
    );
    assert.strictEqual(
      CustomFieldService.formatValueForDisplay(definition, 12.5),
      "12.5",
    );
  });

  it("passes string and text values through unchanged", () => {
    for (const inputType of ["string", "text"]) {
      const definition = checkoutField({ inputType });

      assert.strictEqual(
        CustomFieldService.formatValueForDisplay(
          definition,
          "Zeile 1\nZeile 2",
        ),
        "Zeile 1\nZeile 2",
      );
    }
  });
});

describe("MailDataService.generateBookingDetails (mailCustomFields)", () => {
  afterEach(() => {
    sinon.restore();
  });

  function stubBooking(customFields) {
    sinon.stub(BookingManager, "getBooking").resolves({
      id: "B-1",
      priceEur: 10,
      comment: "",
      bookableItems: [],
      timeBegin: null,
      timeEnd: null,
      customFields,
    });
    sinon.stub(TenantManager, "getTenant").resolves({});
    sinon.stub(BookableManager, "getBookables").resolves([]);
  }

  it("renders only fields flagged with showInMail", async () => {
    stubBooking([
      {
        ...checkoutField({ id: "field-a", caption: "Anzahl Personen" }),
        value: "4 Erwachsene",
        hasValue: true,
      },
      {
        ...checkoutField({
          id: "field-b",
          caption: "Internes Feld",
          usageOptions: { context: "checkout", showInMail: false },
        }),
        value: "geheim",
        hasValue: true,
      },
    ]);

    const html = await MailDataService.generateBookingDetails("B-1", "tenant");

    assert.ok(html.includes("<strong>Anzahl Personen:</strong>"));
    assert.ok(html.includes("4 Erwachsene"));
    assert.ok(!html.includes("Internes Feld"));
    assert.ok(!html.includes("geheim"));
  });

  it("renders boolean and select values human-readable", async () => {
    stubBooking([
      {
        ...checkoutField({
          id: "field-bool",
          caption: "Barrierefrei",
          inputType: "boolean",
        }),
        value: false,
        hasValue: true,
      },
      {
        ...checkoutField({
          id: "field-select",
          caption: "Raumgröße",
          inputType: "select",
          options: [{ value: "l", caption: "Großer Saal" }],
        }),
        value: "l",
        hasValue: true,
      },
    ]);

    const html = await MailDataService.generateBookingDetails("B-1", "tenant");

    assert.ok(html.includes("<strong>Barrierefrei:</strong>"));
    assert.ok(html.includes("Nein"));
    assert.ok(html.includes("Großer Saal"));
    assert.ok(!html.includes("nicht angegeben"));
  });

  it("renders flagged fields without a value as nicht angegeben", async () => {
    stubBooking([{ ...checkoutField(), value: null, hasValue: false }]);

    const html = await MailDataService.generateBookingDetails("B-1", "tenant");

    assert.ok(html.includes("<strong>Anzahl Personen:</strong>"));
    assert.ok(html.includes("<em>nicht angegeben</em>"));
  });

  it("renders unchanged when the booking has no custom fields", async () => {
    stubBooking(undefined);

    const html = await MailDataService.generateBookingDetails("B-1", "tenant");

    assert.ok(!html.includes("nicht angegeben"));
    assert.ok(!html.includes("<strong>Anzahl Personen:</strong>"));
  });
});

describe("booking-details snippet (mailCustomFields)", () => {
  const baseContext = {
    booking: {
      id: "B-1",
      priceEur: 12.5,
      comment: "Bitte klingeln",
    },
    bookingItems: [],
    coupon: null,
    bookingPeriod: "01.01.2026 10:00 - 12:00",
  };

  it("renders filled fields as Label: Wert after the booking comment", () => {
    const html = renderSnippet("booking-details", {
      ...baseContext,
      mailCustomFields: [
        { caption: "Anzahl Personen", displayValue: "4 Erwachsene" },
      ],
    });

    assert.ok(html.includes("<strong>Anzahl Personen:</strong>"));
    assert.ok(html.includes("4 Erwachsene"));
    const commentIndex = html.indexOf("Hinweise zur Buchung");
    const fieldIndex = html.indexOf("Anzahl Personen");
    const periodIndex = html.indexOf("Buchungszeitraum");
    assert.ok(commentIndex < fieldIndex && fieldIndex < periodIndex);
  });

  it("escapes user-entered values", () => {
    const html = renderSnippet("booking-details", {
      ...baseContext,
      mailCustomFields: [
        { caption: "Kommentar", displayValue: "<script>alert(1)</script>" },
      ],
    });

    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("renders empty values as italic nicht angegeben", () => {
    const html = renderSnippet("booking-details", {
      ...baseContext,
      mailCustomFields: [{ caption: "Anzahl Personen", displayValue: null }],
    });

    assert.ok(html.includes("<strong>Anzahl Personen:</strong>"));
    assert.ok(html.includes("<em>nicht angegeben</em>"));
  });

  it("renders byte-identical to a context without mailCustomFields", () => {
    const withoutKey = renderSnippet("booking-details", baseContext);
    const withEmptyList = renderSnippet("booking-details", {
      ...baseContext,
      mailCustomFields: [],
    });

    assert.strictEqual(withEmptyList, withoutKey);
    assert.ok(!withoutKey.includes("nicht angegeben"));
  });
});
