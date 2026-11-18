/**
 * The tenant's bank account in the invoice application (ECCdigital/tickets#16):
 * stored only encrypted with `CRYPTO_SECRET`, read back in plain text, and
 * a value still in plain text - from before the migration - read as it is.
 */

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const { expect } = require("chai");

const {
  TenantEncryptionService,
} = require("../src/commons/services/encryptionService");
const InvoiceApplication = require("../src/commons/entities/application/payment/invoiceApplication");
const SecurityUtils = require("../src/commons/utilities/security-utils");

const ACCOUNT = {
  bank: "Sparkasse",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  accountHolder: "Stadt Musterhausen",
};
const FIELDS = Object.keys(ACCOUNT);

function invoiceApp(overrides = {}) {
  return {
    type: "payment",
    id: "invoice",
    active: true,
    daysUntilPaymentDue: 14,
    ...ACCOUNT,
    ...overrides,
  };
}

const invoiceOf = (tenant) =>
  tenant.applications.find((app) => app.id === "invoice");

describe("the bank account of the invoice application", function () {
  const secret = process.env.CRYPTO_SECRET;

  afterEach(function () {
    process.env.CRYPTO_SECRET = secret;
  });

  it("is encrypted field by field when the tenant is written", function () {
    const tenant = { applications: [invoiceApp()] };

    TenantEncryptionService.encrypt(tenant);

    const app = invoiceOf(tenant);
    for (const field of FIELDS) {
      expect(SecurityUtils.isEncrypted(app[field]), field).to.equal(true);
    }
    expect(app.daysUntilPaymentDue).to.equal(14);
    expect(JSON.stringify(tenant)).not.to.contain(ACCOUNT.iban);
  });

  it("reads back in plain text", function () {
    const tenant = { applications: [invoiceApp()] };
    TenantEncryptionService.encrypt(tenant);

    TenantEncryptionService.decrypt(tenant);

    expect(invoiceOf(tenant)).to.include(ACCOUNT);
  });

  it("reads a value still in plain text as it is", function () {
    const tenant = { applications: [invoiceApp()] };

    TenantEncryptionService.decrypt(tenant);

    expect(invoiceOf(tenant)).to.include(ACCOUNT);
  });

  it("refuses a value that is not text, an object sent as if encrypted", function () {
    const app = new InvoiceApplication(
      invoiceApp({ iban: { iv: "00", data: "00" } }),
    );

    expect(() => app.encrypt()).to.throw(/iban must be text/);
  });

  it("keeps empty fields empty", function () {
    const app = new InvoiceApplication(
      invoiceApp({ bank: "", iban: "", bic: "", accountHolder: "" }),
    );

    app.encrypt();
    app.decrypt();

    expect(app).to.include({ bank: "", iban: "", bic: "", accountHolder: "" });
  });

  it("is not written in plain text without CRYPTO_SECRET", function () {
    delete process.env.CRYPTO_SECRET;
    const tenant = { applications: [invoiceApp()] };

    expect(() => TenantEncryptionService.encrypt(tenant)).to.throw(
      /CRYPTO_SECRET/,
    );
  });
});
