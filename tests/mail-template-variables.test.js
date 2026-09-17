/**
 * Mail variables in every field of a mail template (glossary
 * "Mail-Variable", "Mail-Vorlage"; spec `.scratch/mail-template-variables`):
 * the `urlEncode` helper as a unit over `Handlebars.compile`, and the save
 * validation of `validateMailSnippets` / `validateMailSubjects`, which
 * refuses a helper the platform does not register.
 */

const { expect } = require("chai");
const Handlebars = require("handlebars");

const {
  MAIL_HELPER_NAMES,
} = require("../src/commons/mail-service/mail-service");
const {
  renderSubjectOverride,
  validateMailSnippets,
  validateMailSubjects,
} = require("../src/commons/mail-service/templates/mail-snippet-overrides");
const { BadRequestError } = require("../src/errors/BaseError");

describe("Mail-Variable: urlEncode helper", () => {
  const render = (source, data) => Handlebars.compile(source)(data);

  it("is registered under the exported helper names", () => {
    expect(MAIL_HELPER_NAMES).to.deep.equal([
      "formatDateTime",
      "formatDate",
      "priceFormatted",
      "sanitizeString",
      "gt",
      "urlEncode",
    ]);
    expect(Object.isFrozen(MAIL_HELPER_NAMES)).to.equal(true);
    MAIL_HELPER_NAMES.forEach((name) => {
      expect(Handlebars.helpers, name).to.have.property(name);
    });
  });

  it("encodes a text value for a query string", () => {
    expect(
      render("?name={{urlEncode customerName}}", {
        customerName: "Max Mustermann",
      }),
    ).to.equal("?name=Max%20Mustermann");
  });

  it("encodes reserved characters and lets Handlebars HTML-escape the result", () => {
    expect(render("{{urlEncode v}}", { v: "a&b=c/d?e ä'" })).to.equal(
      "a%26b%3Dc%2Fd%3Fe%20%C3%A4&#x27;",
    );
  });

  it("encodes a number", () => {
    expect(render("{{urlEncode v}}", { v: 42.5 })).to.equal("42.5");
  });

  it("renders null and undefined as an empty string", () => {
    expect(render("[{{urlEncode v}}]", { v: null })).to.equal("[]");
    expect(render("[{{urlEncode v}}]", {})).to.equal("[]");
  });

  it("renders an object, a SafeString and a missing argument as an empty string", () => {
    expect(render("[{{urlEncode v}}]", { v: { a: 1 } })).to.equal("[]");
    expect(
      render("[{{urlEncode v}}]", {
        v: new Handlebars.SafeString("<b>Max</b>"),
      }),
    ).to.equal("[]");
    expect(render("[{{urlEncode}}]", {})).to.equal("[]");
  });

  it("returns a plain string, not a SafeString", () => {
    const result = Handlebars.helpers.urlEncode("Max Mustermann");
    expect(result).to.be.a("string");
    expect(result).to.equal("Max%20Mustermann");
  });
});

describe("Mail-Vorlage: urlEncode in the subject", () => {
  it("renders {{urlEncode}} in a subject override", () => {
    expect(
      renderSubjectOverride("Buchung {{urlEncode customerName}}", {
        customerName: "Max Mustermann",
      }),
    ).to.equal("Buchung Max%20Mustermann");
  });
});

describe("Mail-Vorlage: save validation refuses an unknown helper", () => {
  const expectBadRequest = (fn, ...fragments) => {
    let caught;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(caught, "expected a BadRequestError").to.be.instanceOf(
      BadRequestError,
    );
    expect(caught.statusCode).to.equal(400);
    fragments.forEach((fragment) => {
      expect(caught.message).to.include(fragment);
    });
  };

  it("refuses a snippet with an unknown helper, naming key and helper", () => {
    expectBadRequest(
      () =>
        validateMailSnippets({
          "booking-confirmation": "<p>{{shout customerName}}</p>",
        }),
      "booking-confirmation",
      "shout",
    );
  });

  it("refuses an unknown block helper in an __after snippet", () => {
    expectBadRequest(
      () =>
        validateMailSnippets({
          "booking-cancel__after": "{{#repeat 3}}x{{/repeat}}",
        }),
      "booking-cancel__after",
      "repeat",
    );
  });

  it("refuses a subject with an unknown helper, naming key and helper", () => {
    expectBadRequest(
      () => validateMailSubjects({ invoice: "{{upper tenantName}}" }),
      "invoice",
      "upper",
    );
  });

  it("accepts the six registered helpers in a snippet", () => {
    expect(() =>
      validateMailSnippets({
        "booking-confirmation": [
          "{{formatDateTime timeBegin}}",
          "{{formatDate timeBegin}}",
          "{{priceFormatted refundAmountEur}}",
          "{{sanitizeString customerName}}",
          "{{#gt refundAmountEur 0}}x{{/gt}}",
          "{{urlEncode customerName}}",
        ].join(" "),
      }),
    ).to.not.throw();
  });

  it("accepts the Handlebars built-ins in a snippet", () => {
    expect(() =>
      validateMailSnippets({
        "booking-cancel": [
          "{{#if hasRefundPreview}}a{{else}}b{{/if}}",
          "{{#unless hasCancellationFee}}c{{/unless}}",
          "{{#each items}}{{this}}{{/each}}",
          "{{#with booking}}{{name}}{{/with}}",
          "{{lookup items 0}}",
          "{{log tenantName}}",
        ].join(" "),
      }),
    ).to.not.throw();
  });

  it("accepts a plain variable and the registered helpers in a subject", () => {
    expect(() =>
      validateMailSubjects({
        invoice:
          "{{tenantName}} {{urlEncode customerName}} {{formatDate currentDate}}",
      }),
    ).to.not.throw();
  });
});
