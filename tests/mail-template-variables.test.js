/**
 * Mail variables in every field of a mail template (glossary
 * "Mail-Variable", "Mail-Vorlage"; spec `.scratch/mail-template-variables`):
 * the `urlEncode` helper as a unit over `Handlebars.compile`, and the save
 * validation of `validateMailSnippets` / `validateMailSubjects`, which
 * refuses a helper the platform does not register.
 */

const { expect } = require("chai");
const Handlebars = require("handlebars");
const sinon = require("sinon");
const prettier = require("prettier");

const {
  MAIL_HELPER_NAMES,
} = require("../src/commons/mail-service/mail-service");
const { compose } = require("../src/commons/mail-service");
const {
  renderSubjectOverride,
  validateMailSnippets,
  validateMailSubjects,
  templateVariableCatalog,
} = require("../src/commons/mail-service/templates/mail-snippet-overrides");
const { BadRequestError } = require("../src/errors/BaseError");
const {
  TENANT,
  GROUP,
  GROUP_MEMBER_IDS,
  SUPERVISOR,
  FRONTEND_URL,
  BACKEND_URL,
  NOW,
  tenant,
  booking,
  installMailStackStore,
} = require("./helpers/mail-stack-fixtures");
const { expectSnapshot } = require("./helpers/snapshot");
const {
  installHarness,
  TENANT: HARNESS_TENANT,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");

describe("Mail-Variable: urlEncode helper", () => {
  const render = (source, data) => Handlebars.compile(source)(data);

  it("is registered under the exported helper names", () => {
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

/*
 * The seven new Mail-Variablen, filled by the booking state (spec 2.4):
 * rendered over `compose` against the fixture store with a probe snippet
 * of this file's own. The wrappers stay as the snapshots of
 * `mail-characterization.test.js` pin them; the variables come on top.
 *
 * Handlebars HTML-escapes a variable in `{{ }}`: `=` becomes `&#x3D;` and
 * `&` becomes `&amp;`, in the URLs below as in the wrapper links of the
 * snapshots. A mail client reads them back as the plain address.
 */

/** Every new variable between brackets, one per line, for an exact assertion. */
const PROBE_SNIPPET = [
  "bookingId=[{{bookingId}}]",
  "groupBookingId=[{{groupBookingId}}]",
  "isAggregated=[{{#if isAggregated}}yes{{else}}no{{/if}}]",
  "tenantId=[{{tenantId}}]",
  "bookingStatusUrl=[{{bookingStatusUrl}}]",
  "cancellationUrl=[{{cancellationUrl}}]",
  "paymentUrl=[{{paymentUrl}}]",
].join("\n");

/** The fixture tenant with one snippet replaced by this file's own source. */
function tenantWithSnippet(snippetName, source, overrides = {}) {
  const base = tenant(overrides);
  return {
    ...base,
    mailSnippets: { ...base.mailSnippets, [snippetName]: source },
  };
}

describe("Mail-Variable: filled by the booking state over compose", function () {
  let env;

  beforeEach(function () {
    env = {
      FRONTEND_URL: process.env.FRONTEND_URL,
      BACKEND_URL: process.env.BACKEND_URL,
    };
    process.env.FRONTEND_URL = FRONTEND_URL;
    process.env.BACKEND_URL = BACKEND_URL;
    sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(function () {
    sinon.restore();
    process.env.FRONTEND_URL = env.FRONTEND_URL;
    process.env.BACKEND_URL = env.BACKEND_URL;
  });

  const single = (id = "B-1") => ({ tenantId: TENANT, bookingIds: [id] });
  const group = () => ({
    tenantId: TENANT,
    bookingIds: GROUP_MEMBER_IDS,
    groupBookingId: GROUP,
  });

  it("tracer: a status button in the booking confirmation links the tenant's real status page with the encoded customer name", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet(
        "booking-confirmation",
        '<a class="status" href="{{bookingStatusUrl}}?name={{urlEncode customerName}}">Status</a>',
      ),
    });

    const [mail] = await compose("BOOKING_CONFIRMATION", single());

    expect(mail.html).to.include(
      '<a class="status" href="https://buchung.example.test/booking/status/stadthalle?id&#x3D;B-1&amp;name&#x3D;Erika%20Musterfrau?name=Erika%20Musterfrau">Status</a>',
    );
  });

  it("a single notice: bookingId, tenantId, bookingStatusUrl and cancellationUrl filled, groupBookingId and paymentUrl empty, isAggregated false", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("booking-confirmation", PROBE_SNIPPET),
    });

    const [mail] = await compose("BOOKING_CONFIRMATION", single());

    expect(mail.html).to.include(
      [
        "bookingId=[B-1]",
        "groupBookingId=[]",
        "isAggregated=[no]",
        "tenantId=[stadthalle]",
        "bookingStatusUrl=[https://buchung.example.test/booking/status/stadthalle?id&#x3D;B-1&amp;name&#x3D;Erika%20Musterfrau]",
        "cancellationUrl=[https://buchung.example.test/booking/request-reject/stadthalle?id&#x3D;B-1]",
        "paymentUrl=[]",
      ].join("\n"),
    );
  });

  it("bookingStatusUrl is empty without the tenant's public status view", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("booking-confirmation", PROBE_SNIPPET, {
        enablePublicStatusView: false,
      }),
    });

    const [mail] = await compose("BOOKING_CONFIRMATION", single());

    expect(mail.html).to.include("bookingStatusUrl=[]");
    expect(mail.html).to.include("bookingId=[B-1]");
  });

  it("cancellationUrl is empty when the customer may not cancel", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("booking-confirmation", PROBE_SNIPPET),
      bookings: [
        booking({
          cancellationPolicy: { userCancellable: false, contactHint: "" },
        }),
      ],
    });

    const [mail] = await compose("BOOKING_CONFIRMATION", single());

    expect(mail.html).to.include("cancellationUrl=[]");
  });

  it("cancellationUrl is empty when the booking is no longer live", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("booking-confirmation", PROBE_SNIPPET),
      bookings: [booking({ status: "rejected" })],
    });

    const [mail] = await compose("BOOKING_CONFIRMATION", single());

    expect(mail.html).to.include("cancellationUrl=[]");
    expect(mail.html).to.include("bookingId=[B-1]");
  });

  it("cancellationUrl is filled for a requested booking the customer may cancel", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("booking-request-confirmation", PROBE_SNIPPET),
      bookings: [booking({ id: "B-req", status: "requested" })],
    });

    const [mail] = await compose(
      "BOOKING_REQUEST_CONFIRMATION",
      single("B-req"),
    );

    expect(mail.html).to.include(
      "cancellationUrl=[https://buchung.example.test/booking/request-reject/stadthalle?id&#x3D;B-req]",
    );
  });

  it("a Sammelmitteilung empties bookingId, bookingStatusUrl and cancellationUrl and fills groupBookingId and isAggregated", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("booking-confirmation", PROBE_SNIPPET),
    });

    const [mail] = await compose("BOOKING_CONFIRMATION", group());

    expect(mail.html).to.include(
      [
        "bookingId=[]",
        "groupBookingId=[G-stadthalle]",
        "isAggregated=[yes]",
        "tenantId=[stadthalle]",
        "bookingStatusUrl=[]",
        "cancellationUrl=[]",
        "paymentUrl=[]",
      ].join("\n"),
    );
  });

  it("paymentUrl is the payment link of PAYMENT_LINK_AFTER_APPROVAL", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("payment-link-after-approval", PROBE_SNIPPET),
    });

    const [mail] = await compose("PAYMENT_LINK_AFTER_APPROVAL", {
      ...single(),
      paymentUrl:
        "https://buchung.example.test/payment/redirection?ids=B-1&tenant=stadthalle&aggregated=false",
    });

    expect(mail.html).to.include(
      "paymentUrl=[https://buchung.example.test/payment/redirection?ids&#x3D;B-1&amp;tenant&#x3D;stadthalle&amp;aggregated&#x3D;false]",
    );
  });

  it("paymentUrl of a group is the one link for all members", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("payment-link-after-approval", PROBE_SNIPPET),
    });

    const [mail] = await compose("PAYMENT_LINK_AFTER_APPROVAL", {
      ...group(),
      paymentUrl:
        "https://buchung.example.test/payment/redirection?ids=G-1,G-2,G-3&tenant=stadthalle&aggregated=true",
    });

    expect(mail.html).to.include(
      "paymentUrl=[https://buchung.example.test/payment/redirection?ids&#x3D;G-1,G-2,G-3&amp;tenant&#x3D;stadthalle&amp;aggregated&#x3D;true]",
    );
    expect(mail.html).to.include("groupBookingId=[G-stadthalle]");
  });

  it("tenantId is filled in the single and in the aggregated notice", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet("invoice", "tenant=[{{tenantId}}]"),
    });

    const [singleMail] = await compose("INVOICE", single());
    const [groupMail] = await compose("INVOICE", group());

    expect(singleMail.html).to.include("tenant=[stadthalle]");
    expect(groupMail.html).to.include("tenant=[stadthalle]");
  });

  it("a tenant mail (SUPERVISOR_BOOKING_NOTIFICATION) fills the variables too, regardless of its rejection link and QR code", async function () {
    installMailStackStore({
      tenant: tenantWithSnippet(
        "supervisor-booking-notification",
        PROBE_SNIPPET,
      ),
    });

    const [mail] = await compose("SUPERVISOR_BOOKING_NOTIFICATION", single());

    expect(mail.to).to.equal(SUPERVISOR);
    expect(mail.html).to.include(
      [
        "bookingId=[B-1]",
        "groupBookingId=[]",
        "isAggregated=[no]",
        "tenantId=[stadthalle]",
        "bookingStatusUrl=[https://buchung.example.test/booking/status/stadthalle?id&#x3D;B-1&amp;name&#x3D;Erika%20Musterfrau]",
        "cancellationUrl=[https://buchung.example.test/booking/request-reject/stadthalle?id&#x3D;B-1]",
        "paymentUrl=[]",
      ].join("\n"),
    );
  });
});

/*
 * The Variablenkatalog (glossary): the one list the admin UI reads, served
 * per tenant by `GET /api/tenants/:tenant/mail/templates/default` in
 * `templateVariables` (spec 2.1-2.3). As a unit over
 * `templateVariableCatalog`, and over the lifecycle harness with a snapshot.
 */

/** The 19 entries of spec 2.3, in picker order. */
const CATALOG_ORDER = [
  "tenantName",
  "supportEmail",
  "customerName",
  "customerContact",
  "currentDate",
  "hasRefundPreview",
  "refundAmountEur",
  "cancellationFeeEur",
  "originalAmountEur",
  "refundPercentage",
  "hasCancellationFee",
  "daysBeforeStart",
  "bookingId",
  "groupBookingId",
  "isAggregated",
  "tenantId",
  "bookingStatusUrl",
  "cancellationUrl",
  "paymentUrl",
];

describe("Variablenkatalog: templateVariableCatalog", function () {
  const catalog = () => templateVariableCatalog({ tenantId: "stadthalle" });

  it("lists the 19 entries in the order of the spec", function () {
    expect(catalog().map((entry) => entry.name)).to.deep.equal(CATALOG_ORDER);
  });

  it("gives every entry name, label, description, kind and sample", function () {
    const KINDS = ["text", "number", "flag", "url", "html"];
    catalog().forEach((entry) => {
      ["name", "label", "description"].forEach((field) => {
        expect(entry[field], `${entry.name}.${field}`)
          .to.be.a("string")
          .and.not.equal("");
      });
      expect(KINDS, `${entry.name}.kind`).to.include(entry.kind);
      expect(entry, entry.name).to.have.property("sample");
    });
  });

  it("carries a non-empty requires.text wherever requires is present", function () {
    const conditional = catalog().filter((entry) => entry.requires);
    expect(conditional.map((entry) => entry.name)).to.deep.equal([
      "bookingStatusUrl",
      "cancellationUrl",
    ]);
    conditional.forEach((entry) => {
      expect(entry.requires.text, entry.name)
        .to.be.a("string")
        .and.not.equal("");
    });
    const status = catalog().find((entry) => entry.name === "bookingStatusUrl");
    expect(status.requires.tenantSetting).to.deep.equal({
      key: "enablePublicStatusView",
      label: "Öffentliche Status-Seite",
    });
  });

  it("marks the booking-bound entries with an empty aggregated sample", function () {
    const byName = Object.fromEntries(catalog().map((e) => [e.name, e]));
    ["bookingId", "bookingStatusUrl", "cancellationUrl"].forEach((name) => {
      expect(byName[name].sampleAggregated, name).to.equal("");
    });
    expect(byName.groupBookingId.sample).to.equal("");
    expect(byName.groupBookingId.sampleAggregated).to.equal("GB-123456");
    expect(byName.isAggregated.sample).to.equal(false);
    expect(byName.isAggregated.sampleAggregated).to.equal(true);
  });

  it("scopes the cancellation and payment variables to their snippets", function () {
    const byName = Object.fromEntries(catalog().map((e) => [e.name, e]));
    CATALOG_ORDER.slice(5, 12).forEach((name) => {
      expect(byName[name].snippets, name).to.deep.equal(["booking-cancel"]);
    });
    expect(byName.paymentUrl.snippets).to.deep.equal([
      "payment-link-after-approval",
    ]);
    expect(byName.tenantName).to.not.have.property("snippets");
  });
});

describe("Variablenkatalog: GET /api/tenants/:tenant/mail/templates/default", function () {
  this.timeout(20000);

  let h;
  let frontendUrl;

  before(async function () {
    frontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;
    h = await installHarness();
    installRouteWorld({
      tenantId: HARNESS_TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
  });

  after(async function () {
    sinon.restore();
    process.env.FRONTEND_URL = frontendUrl;
    await h.close();
  });

  const getDefaults = () =>
    h
      .api()
      .get(`/api/tenants/${HARNESS_TENANT}/mail/templates/default`)
      .set(h.as(OWNER));

  it("serves the catalog of the tenant, pinned by snapshot", async function () {
    const res = await getDefaults();

    expect(res.status).to.equal(200);
    // Shaped as `format:write` would leave the file, so the snapshot is
    // committed as it is recorded.
    const json = await prettier.format(
      JSON.stringify(res.body.templateVariables, null, 2),
      { parser: "json" },
    );
    expectSnapshot("mail/template-variables.json", json);
  });

  it("samples every url entry with FRONTEND_URL and the tenantId of the route", async function () {
    const res = await getDefaults();

    const urls = res.body.templateVariables.filter((e) => e.kind === "url");
    expect(urls.map((e) => e.name)).to.deep.equal([
      "bookingStatusUrl",
      "cancellationUrl",
      "paymentUrl",
    ]);
    urls.forEach((entry) => {
      expect(entry.sample, entry.name).to.satisfy((sample) =>
        sample.startsWith(`${FRONTEND_URL}/`),
      );
      expect(entry.sample, entry.name).to.include(HARNESS_TENANT);
    });
    expect(
      res.body.templateVariables.find((e) => e.name === "tenantId").sample,
    ).to.equal(HARNESS_TENANT);
  });
});
