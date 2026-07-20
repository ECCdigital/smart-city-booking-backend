const mock = require("mock-require");
const { expect } = require("chai");

// Regression guard for the multi-tenant isolation invariant: every read/write
// that touches tenant-scoped data must carry tenantId in its Mongo filter, so a
// dropped tenantId (a cross-tenant IDOR) fails CI instead of shipping green.
describe("Manager tenancy — tenantId is always in the query filter", () => {
  let captured;

  const capturingModel = () => ({
    findOne(filter) {
      captured.filter = filter;
      return Promise.resolve(null);
    },
    find(filter) {
      captured.filter = filter;
      const chain = {
        sort: () => chain,
        limit: () => chain,
        skip: () => chain,
        then: (resolve) => resolve([]),
      };
      return chain;
    },
    updateOne(filter) {
      captured.filter = filter;
      return Promise.resolve();
    },
  });

  const load = (modelPath, managerPath) => {
    mock(modelPath, capturingModel());
    return mock.reRequire(managerPath);
  };

  beforeEach(() => {
    captured = {};
  });

  afterEach(() => {
    mock.stopAll();
  });

  it("application-manager.getById filters by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/applicationModel",
      "../../src/commons/data-managers/application-manager",
    );
    await M.getById("kg", "a1");
    expect(captured.filter).to.include({ tenantId: "kg", id: "a1" });
  });

  it("application-manager.getByCompany filters by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/applicationModel",
      "../../src/commons/data-managers/application-manager",
    );
    await M.getByCompany("kg", "c1");
    expect(captured.filter).to.include({ tenantId: "kg", companyId: "c1" });
  });

  it("application-manager.listByUser filters by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/applicationModel",
      "../../src/commons/data-managers/application-manager",
    );
    await M.listByUser("kg", "lena@x.de");
    expect(captured.filter).to.include({
      tenantId: "kg",
      studentUserId: "lena@x.de",
    });
  });

  it("company-member-manager.getMemberByUser filters by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/companyMemberModel",
      "../../src/commons/data-managers/company-member-manager",
    );
    await M.getMemberByUser("kg", "u@x.de");
    expect(captured.filter).to.include({ tenantId: "kg", userId: "u@x.de" });
  });

  it("company-manager.getCompany filters by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/companyModel",
      "../../src/commons/data-managers/company-manager",
    );
    await M.getCompany("kg", "c1");
    expect(captured.filter).to.include({ tenantId: "kg", id: "c1" });
  });

  it("offer-manager.getOffer filters by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/offerModel",
      "../../src/commons/data-managers/offer-manager",
    );
    await M.getOffer("kg", "o1");
    expect(captured.filter).to.include({ tenantId: "kg", id: "o1" });
  });

  it("offer-bookmark-manager.getByUser filters by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/offerBookmarkModel",
      "../../src/commons/data-managers/offer-bookmark-manager",
    );
    await M.getByUser("kg", "lena@x.de");
    expect(captured.filter).to.include({ tenantId: "kg", userId: "lena@x.de" });
  });

  it("offer-bookmark-manager.add scopes the upsert by tenantId", async () => {
    const M = load(
      "../../src/commons/data-managers/models/offerBookmarkModel",
      "../../src/commons/data-managers/offer-bookmark-manager",
    );
    await M.add("kg", "lena@x.de", "o1");
    expect(captured.filter).to.include({
      tenantId: "kg",
      userId: "lena@x.de",
      offerId: "o1",
    });
  });
});
