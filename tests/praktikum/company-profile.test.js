const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("CompanyService — profile", () => {
  let sandbox;
  let CompanyManager;
  let TaxonomyTermManager;
  let CompanyMediaManager;
  let CompanyService;

  const existing = () => ({
    id: "c1",
    tenantId: "kielregion",
    name: "Alt GmbH",
    slug: "",
    status: "verified",
    mail: "old@x.de",
    phone: "1",
    website: "",
    street: "",
    postalCode: "",
    city: "Kiel",
    districtId: "",
    industryId: "",
    sizeId: "",
    logoUrl: "",
    description: "old",
    created: 1,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    CompanyManager = {
      getCompany: sandbox.stub(),
      storeCompany: sandbox.stub().resolves(),
      setLogo: sandbox.stub().resolves(),
    };
    TaxonomyTermManager = { getTerm: sandbox.stub().resolves(null) };
    CompanyMediaManager = {
      getMediaByCompany: sandbox.stub().resolves([]),
      getMedia: sandbox.stub().resolves(null),
      storeMedia: sandbox.stub().callsFake(async (m) => m),
      removeMedia: sandbox.stub().resolves(),
    };

    mock("../../src/commons/data-managers/company-manager", CompanyManager);
    mock(
      "../../src/commons/data-managers/taxonomy-term-manager",
      TaxonomyTermManager,
    );
    mock(
      "../../src/commons/data-managers/company-media-manager",
      CompanyMediaManager,
    );

    CompanyService = mock.reRequire(
      "../../src/commons/services/company/company-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("updateCompanyProfile", () => {
    it("updates fields and preserves status (no re-approval)", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.updateCompanyProfile("kielregion", "c1", {
        name: "Neu GmbH",
        website: "https://neu.de",
        phone: "999",
      });
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.name).to.equal("Neu GmbH");
      expect(stored.website).to.equal("https://neu.de");
      expect(stored.phone).to.equal("999");
      expect(stored.status).to.equal("verified");
      expect(stored.id).to.equal("c1");
      expect(stored.city).to.equal("Kiel");
    });

    it("preserves an unverified status (editing never re-triggers approval)", async () => {
      CompanyManager.getCompany.resolves({
        ...existing(),
        status: "unverified",
      });
      await CompanyService.updateCompanyProfile("kielregion", "c1", {
        name: "Neu GmbH",
      });
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.status).to.equal("unverified");
    });

    it("does not let the payload overwrite logoUrl (logo is set via its own endpoints)", async () => {
      CompanyManager.getCompany.resolves({
        ...existing(),
        logoUrl: "keep.png",
      });
      await CompanyService.updateCompanyProfile("kielregion", "c1", {
        name: "X",
        logoUrl: "http://evil/x?name=/../../other/secret",
      });
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.logoUrl).to.equal("keep.png");
    });

    it("throws 404 when the company does not exist", async () => {
      CompanyManager.getCompany.resolves(null);
      let error;
      try {
        await CompanyService.updateCompanyProfile("kielregion", "x", {
          name: "X",
        });
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(404);
    });

    it("rejects an empty name (400)", async () => {
      CompanyManager.getCompany.resolves(existing());
      let error;
      try {
        await CompanyService.updateCompanyProfile("kielregion", "c1", {
          name: "   ",
        });
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    it("rejects a name longer than 200 (400)", async () => {
      CompanyManager.getCompany.resolves(existing());
      let error;
      try {
        await CompanyService.updateCompanyProfile("kielregion", "c1", {
          name: "a".repeat(201),
        });
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    it("rejects a non-https website (400)", async () => {
      CompanyManager.getCompany.resolves(existing());
      let error;
      try {
        await CompanyService.updateCompanyProfile("kielregion", "c1", {
          name: "X",
          website: "http://x.de",
        });
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    it("rejects a website with trailing junk after a space (400)", async () => {
      CompanyManager.getCompany.resolves(existing());
      let error;
      try {
        await CompanyService.updateCompanyProfile("kielregion", "c1", {
          name: "X",
          website: "https://x.de bar",
        });
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    it("trims surrounding whitespace from the website before storing", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.updateCompanyProfile("kielregion", "c1", {
        name: "X",
        website: "  https://x.de  ",
      });
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.website).to.equal("https://x.de");
    });

    it("rejects an invalid contact email (400)", async () => {
      CompanyManager.getCompany.resolves(existing());
      let error;
      try {
        await CompanyService.updateCompanyProfile("kielregion", "c1", {
          name: "X",
          mail: "not-an-email",
        });
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    it("rejects an invalid taxonomy ref (400)", async () => {
      CompanyManager.getCompany.resolves(existing());
      TaxonomyTermManager.getTerm.resolves(null);
      let error;
      try {
        await CompanyService.updateCompanyProfile("kielregion", "c1", {
          name: "X",
          districtId: "bogus",
        });
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(400);
    });

    it("stores the description verbatim, keeping < and > in legitimate prose", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.updateCompanyProfile("kielregion", "c1", {
        name: "X",
        description: "Wir suchen Azubis < 18 Jahre, Gehalt > 2000 EUR.",
      });
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.description).to.equal(
        "Wir suchen Azubis < 18 Jahre, Gehalt > 2000 EUR.",
      );
    });

    it("falls back to the existing description when none is provided", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.updateCompanyProfile("kielregion", "c1", {
        name: "X",
      });
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.description).to.equal("old");
    });

    it("coerces a non-string description to a string (never a type error)", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.updateCompanyProfile("kielregion", "c1", {
        name: "X",
        description: 12345,
      });
      const stored = CompanyManager.storeCompany.firstCall.args[0];
      expect(stored.description).to.equal("12345");
    });
  });

  describe("logo", () => {
    it("setCompanyLogo stores the url", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.setCompanyLogo("kielregion", "c1", "http://x/l.png");
      expect(
        CompanyManager.setLogo.calledWith("kielregion", "c1", "http://x/l.png"),
      ).to.equal(true);
    });

    it("setCompanyLogo throws 404 when the company does not exist", async () => {
      CompanyManager.getCompany.resolves(null);
      let error;
      try {
        await CompanyService.setCompanyLogo("kielregion", "x", "u");
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(404);
    });

    it("removeCompanyLogo clears the url", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.removeCompanyLogo("kielregion", "c1");
      expect(
        CompanyManager.setLogo.calledWith("kielregion", "c1", ""),
      ).to.equal(true);
    });
  });

  describe("media", () => {
    it("addCompanyMedia stores with a generated id", async () => {
      CompanyManager.getCompany.resolves(existing());
      await CompanyService.addCompanyMedia("kielregion", "c1", {
        url: "u",
        fileName: "public/media/x",
        type: "image",
      });
      const stored = CompanyMediaManager.storeMedia.firstCall.args[0];
      expect(stored.companyId).to.equal("c1");
      expect(stored.url).to.equal("u");
      expect(stored.fileName).to.equal("public/media/x");
      expect(stored.type).to.equal("image");
      expect(stored.id).to.be.a("string");
    });

    it("addCompanyMedia throws 404 when the company is missing", async () => {
      CompanyManager.getCompany.resolves(null);
      let error;
      try {
        await CompanyService.addCompanyMedia("kielregion", "x", {});
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(404);
    });

    it("removeCompanyMedia throws 404 when the media is missing", async () => {
      CompanyMediaManager.getMedia.resolves(null);
      let error;
      try {
        await CompanyService.removeCompanyMedia("kielregion", "c1", "m1");
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(404);
    });

    it("removeCompanyMedia throws 404 when the media belongs to another company", async () => {
      CompanyMediaManager.getMedia.resolves({ id: "m1", companyId: "other" });
      let error;
      try {
        await CompanyService.removeCompanyMedia("kielregion", "c1", "m1");
      } catch (e) {
        error = e;
      }
      expect(error.status).to.equal(404);
    });

    it("removeCompanyMedia removes and returns the media", async () => {
      CompanyMediaManager.getMedia.resolves({
        id: "m1",
        companyId: "c1",
        fileName: "public/media/x",
      });
      const media = await CompanyService.removeCompanyMedia(
        "kielregion",
        "c1",
        "m1",
      );
      expect(
        CompanyMediaManager.removeMedia.calledWith("kielregion", "m1"),
      ).to.equal(true);
      expect(media.fileName).to.equal("public/media/x");
    });
  });
});
