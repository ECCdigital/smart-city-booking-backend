/**
 * The Provider Support Contact (`customerService`) of an access
 * application: every access application may carry one, not only iFBS. The
 * constructors whitelist their fields, so a provider whose constructor does
 * not know the field drops it on save - this pins that Nuki keeps it, iFBS
 * keeps working as before, and the tenant's public export carries it for
 * Nuki the same way it does for iFBS.
 */

const { expect } = require("chai");

process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const {
  AccessApplication,
  NukiAccessApplication,
  IfbsAccessApplication,
  createAccessApplication,
} = require("../src/commons/entities/application/accessApplication");
const {
  TenantEncryptionService,
} = require("../src/commons/services/encryptionService");
const Tenant = require("../src/commons/entities/tenant/tenant");

const CUSTOMER_SERVICE = {
  name: "Stadtwerke Hotline",
  phone: "+49 123 456",
  email: "hilfe@stadt.de",
};

function tenantWithNuki() {
  return {
    id: "tenant1",
    name: "Stadt",
    applications: [
      {
        type: "access",
        id: "nuki",
        active: true,
        apiToken: "token",
        customerService: CUSTOMER_SERVICE,
      },
    ],
  };
}

describe("AccessApplication.customerService", function () {
  it("defaults to null on the base access application", function () {
    const app = new AccessApplication({ id: "custom" });

    expect(app.customerService).to.equal(null);
    expect(AccessApplication.Schema.customerService).to.deep.equal({
      type: Object,
      default: null,
    });
  });

  it("is kept by a Nuki access application", function () {
    const app = createAccessApplication({
      id: "nuki",
      apiToken: "token",
      customerService: CUSTOMER_SERVICE,
    });

    expect(app).to.be.instanceOf(NukiAccessApplication);
    expect(app.customerService).to.deep.equal(CUSTOMER_SERVICE);
    expect(NukiAccessApplication.Schema.customerService).to.deep.equal({
      type: Object,
      default: null,
    });
  });

  it("defaults to null on a Nuki access application without one", function () {
    const app = createAccessApplication({ id: "nuki", apiToken: "token" });

    expect(app.customerService).to.equal(null);
  });

  it("is kept by an iFBS access application as before", function () {
    const app = createAccessApplication({
      id: "ifbs",
      serverUrl: "https://ifbs.example",
      customerService: CUSTOMER_SERVICE,
    });

    expect(app).to.be.instanceOf(IfbsAccessApplication);
    expect(app.customerService).to.deep.equal(CUSTOMER_SERVICE);
    expect(IfbsAccessApplication.Schema.customerService).to.deep.equal({
      type: Object,
      default: null,
    });
  });

  it("survives the encryption on the way into the store for Nuki", function () {
    const tenant = tenantWithNuki();

    TenantEncryptionService.encrypt(tenant);

    const [stored] = tenant.applications;
    expect(stored.customerService).to.deep.equal(CUSTOMER_SERVICE);
    expect(stored.apiToken).to.not.equal("token");
  });

  it("reaches the public tenant export for Nuki", function () {
    const tenant = tenantWithNuki();
    TenantEncryptionService.encrypt(tenant);

    const exported = new Tenant(tenant).exportPublic();

    expect(exported.accessApps).to.deep.equal([
      { id: "nuki", customerService: CUSTOMER_SERVICE },
    ]);
  });
});
