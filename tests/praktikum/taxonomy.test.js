const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("TaxonomyService", () => {
  let sandbox;
  let TaxonomyTermManager;
  let TaxonomyService;

  const terms = () => [
    {
      id: "industry-it",
      type: "industry",
      name: "IT",
      color: "#003064",
      sortOrder: 0,
    },
    {
      id: "industry-bau",
      type: "industry",
      name: "Bau",
      color: "#1f4f86",
      sortOrder: 1,
    },
    {
      id: "internship_type-schulpraktikum",
      type: "internship_type",
      name: "Schulpraktikum",
      color: "",
      sortOrder: 0,
    },
  ];

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    TaxonomyTermManager = { getTerms: sandbox.stub().resolves(terms()) };
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    TaxonomyService = mock.reRequire(
      "../../src/commons/services/taxonomy-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("groups terms by type when no type is given", async () => {
    const result = await TaxonomyService.listTaxonomies("kielregion", {});
    expect(Object.keys(result).sort()).to.deep.equal([
      "industry",
      "internship_type",
    ]);
    expect(result.industry).to.have.length(2);
    expect(result.internship_type).to.have.length(1);
  });

  it("returns a flat array for a single type", async () => {
    TaxonomyTermManager.getTerms.resolves(
      terms().filter((t) => t.type === "industry"),
    );
    const result = await TaxonomyService.listTaxonomies("kielregion", {
      type: "industry",
    });
    expect(Array.isArray(result)).to.equal(true);
    expect(result).to.have.length(2);
    expect(
      TaxonomyTermManager.getTerms.calledWithMatch("kielregion", {
        type: "industry",
        activeOnly: true,
      }),
    ).to.equal(true);
  });

  it("maps to a clean DTO (id, type, name, color, sortOrder) and nothing else", async () => {
    const result = await TaxonomyService.listTaxonomies("kielregion", {
      type: "industry",
    });
    expect(result[0]).to.deep.equal({
      id: "industry-it",
      type: "industry",
      name: "IT",
      color: "#003064",
      sortOrder: 0,
    });
  });

  it("always requests active-only terms", async () => {
    await TaxonomyService.listTaxonomies("kielregion", {});
    expect(TaxonomyTermManager.getTerms.firstCall.args[1].activeOnly).to.equal(
      true,
    );
  });
});

describe("TaxonomyTermManager.getTerms — query building", () => {
  let sandbox;
  let captured;
  let TaxonomyTermManager;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    captured = {};
    const FakeModel = {
      find(query) {
        captured.query = query;
        return {
          sort(s) {
            captured.sort = s;
            return Promise.resolve([]);
          },
        };
      },
    };
    mock("../../src/commons/data-managers/models/taxonomyTermModel", FakeModel);
    TaxonomyTermManager = mock.reRequire(
      "../../src/commons/data-managers/taxonomy-term-manager",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("filters by tenant + active by default and sorts by type then sortOrder", async () => {
    await TaxonomyTermManager.getTerms("kielregion");
    expect(captured.query).to.deep.equal({
      tenantId: "kielregion",
      active: true,
    });
    expect(captured.sort).to.deep.equal({ type: 1, sortOrder: 1 });
  });

  it("adds the type filter when given", async () => {
    await TaxonomyTermManager.getTerms("kielregion", { type: "district" });
    expect(captured.query).to.deep.equal({
      tenantId: "kielregion",
      type: "district",
      active: true,
    });
  });

  it("can include inactive terms", async () => {
    await TaxonomyTermManager.getTerms("kielregion", { activeOnly: false });
    expect(captured.query).to.deep.equal({ tenantId: "kielregion" });
  });
});
