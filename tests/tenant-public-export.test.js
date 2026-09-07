/**
 * The public tenant export (`GET /api/tenants/public`) on its access
 * applications: the customer-service contact of every active access
 * application that has one, and nothing else of the application. The
 * export is a whitelist - a secret of an application can only leave when
 * someone writes it in here, so every entry is pinned key by key.
 */

const { expect } = require("chai");

const Tenant = require("../src/commons/entities/tenant/tenant");

const TENANT = "tenant1";

const CUSTOMER_SERVICE = {
  name: "Stadtwerke Hotline",
  phone: "+49 123 456",
  email: "hilfe@stadt.de",
};

function ifbsApp(overrides = {}) {
  return {
    type: "access",
    id: "ifbs",
    active: true,
    title: "iFBS Fahrradboxen",
    serverUrl: "https://ifbs.example",
    apiKeyID: "key-1",
    apiKey: { iv: "iv", data: "secret" },
    secretPhrase: { iv: "iv", data: "phrase" },
    customerService: CUSTOMER_SERVICE,
    ...overrides,
  };
}

function tenantFixture(applications) {
  return new Tenant({ id: TENANT, name: "Stadt", applications });
}

describe("Tenant.exportPublic access apps", function () {
  it("carries id and customer service of an active access app, and nothing else", function () {
    const exported = tenantFixture([ifbsApp()]).exportPublic();

    expect(exported.accessApps).to.deep.equal([
      { id: "ifbs", customerService: CUSTOMER_SERVICE },
    ]);
    expect(Object.keys(exported.accessApps[0])).to.deep.equal([
      "id",
      "customerService",
    ]);
  });

  it("leaves an inactive access app out", function () {
    const exported = tenantFixture([ifbsApp({ active: false })]).exportPublic();

    expect(exported.accessApps).to.deep.equal([]);
  });

  it("leaves a payment or auth app out, even one with a customer service", function () {
    const exported = tenantFixture([
      { type: "payment", id: "invoice", active: true, title: "Rechnung" },
      ifbsApp({ type: "payment", id: "stripe" }),
      ifbsApp({ type: "auth", id: "keycloak" }),
    ]).exportPublic();

    expect(exported.accessApps).to.deep.equal([]);
  });

  it("leaves an access app without a customer service out", function () {
    const exported = tenantFixture([
      ifbsApp({ customerService: null }),
      ifbsApp({ id: "pareva", customerService: undefined }),
      { type: "access", id: "nuki", active: true, apiToken: "token" },
    ]).exportPublic();

    expect(exported.accessApps).to.deep.equal([]);
  });

  it("reduces the customer service to name, phone and email", function () {
    const exported = tenantFixture([
      ifbsApp({
        customerService: {
          ...CUSTOMER_SERVICE,
          address: "Rathausplatz 1",
          openingHours: "Mo-Fr",
        },
      }),
    ]).exportPublic();

    expect(exported.accessApps[0].customerService).to.deep.equal(
      CUSTOMER_SERVICE,
    );
  });

  it("answers a tenant without applications with an empty list", function () {
    const exported = new Tenant({ id: TENANT, name: "Stadt" }).exportPublic();

    expect(exported.accessApps).to.deep.equal([]);
  });

  it("keeps the rest of the public export as it was", function () {
    const exported = new Tenant({
      id: TENANT,
      name: "Stadt",
      mail: "info@stadt.de",
      legalDocuments: [{ type: "legalNotice", title: "", reference: {} }],
      applications: [ifbsApp()],
    }).exportPublic();

    expect(exported).to.include({
      id: TENANT,
      name: "Stadt",
      mail: "info@stadt.de",
    });
    expect(exported).to.not.have.property("legalDocuments");
    expect(exported).to.not.have.property("applications");
  });
});
