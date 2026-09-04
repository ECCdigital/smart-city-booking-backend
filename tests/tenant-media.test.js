const assert = require("assert");
const sinon = require("sinon");

const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { Media } = require("../src/commons/entities/media/media");
const {
  exportTenantMedia,
  tenantDocumentReferences,
} = require("../src/commons/services/media/tenant-media");
const {
  LEGAL_DOCUMENT_TYPE,
} = require("../src/commons/utilities/legal-documents");

const TENANT = "tenant1";
const MEDIA = "doc-1";
const USER = "owner@stadt.de";
// The reach of `media.read` the adapter hands the guard (authorize spec §5).
const PICKER = { reach: "any", userId: USER };
const NO_PICKER = { reach: null, userId: USER };

function mediaReference(mediaId) {
  return { source: "media", mediaId, url: null };
}

function externalReference(url) {
  return { source: "external", mediaId: null, url };
}

function documentFixture(overrides = {}) {
  return new Media({
    id: MEDIA,
    tenantId: TENANT,
    kind: "document",
    mimeType: "application/pdf",
    size: 1024,
    originalFileName: "agb.pdf",
    title: "AGB",
    visibility: "public",
    storage: { provider: "nextcloud", key: `${TENANT}/media/doc-1/agb.pdf` },
    ...overrides,
  });
}

function tenantFixture(legalDocuments) {
  return new Tenant({ id: TENANT, name: "Stadt", legalDocuments });
}

describe("tenant media", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("reference sites", function () {
    it("collects the reference of every legal document", function () {
      const references = tenantDocumentReferences(
        tenantFixture([
          {
            type: LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS,
            title: "",
            reference: mediaReference(MEDIA),
          },
          {
            type: LEGAL_DOCUMENT_TYPE.OTHER,
            title: "Hausordnung",
            reference: externalReference("https://example.org/haus.pdf"),
          },
        ]),
      );

      assert.deepStrictEqual(references, [
        mediaReference(MEDIA),
        externalReference("https://example.org/haus.pdf"),
      ]);
    });

    it("is empty for a tenant without legal documents", function () {
      assert.deepStrictEqual(tenantDocumentReferences(tenantFixture()), []);
      assert.deepStrictEqual(tenantDocumentReferences(undefined), []);
    });
  });

  describe("export enrichment", function () {
    it("resolves a media reference against the tenant scope", function () {
      const exported = exportTenantMedia(
        tenantFixture([
          {
            type: LEGAL_DOCUMENT_TYPE.DATA_PROTECTION,
            title: "",
            reference: mediaReference(MEDIA),
          },
        ]),
      );

      assert.deepStrictEqual(exported.legalDocuments[0], {
        type: LEGAL_DOCUMENT_TYPE.DATA_PROTECTION,
        title: "",
        reference: {
          source: "media",
          mediaId: MEDIA,
          url: `/api/v2/${TENANT}/media/${MEDIA}/file`,
        },
      });
    });

    it("keeps the address of an external reference", function () {
      const exported = exportTenantMedia(
        tenantFixture([
          {
            type: LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE,
            title: "",
            reference: externalReference("https://example.org/impressum"),
          },
        ]),
      );

      assert.strictEqual(
        exported.legalDocuments[0].reference.url,
        "https://example.org/impressum",
      );
    });

    it("exports a document without a reference as an empty site", function () {
      const exported = exportTenantMedia(
        tenantFixture([
          { type: LEGAL_DOCUMENT_TYPE.RIGHT_OF_WITHDRAWAL, title: "" },
        ]),
      );

      assert.strictEqual(exported.legalDocuments[0].reference, null);
    });

    it("leaves the stored tenant untouched", function () {
      const tenant = tenantFixture([
        {
          type: LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS,
          title: "",
          reference: mediaReference(MEDIA),
        },
      ]);

      exportTenantMedia(tenant);

      assert.deepStrictEqual(
        tenant.legalDocuments[0].reference,
        mediaReference(MEDIA),
      );
    });

    it("carries the rest of the tenant through unchanged", function () {
      const exported = exportTenantMedia(tenantFixture());

      assert.strictEqual(exported.id, TENANT);
      assert.strictEqual(exported.name, "Stadt");
      assert.deepStrictEqual(exported.legalDocuments, []);
    });
  });

  describe("reference validation on save", function () {
    function tenantWith(reference) {
      return tenantFixture([
        {
          type: LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS,
          title: "",
          reference,
        },
      ]);
    }

    it("passes a public medium of the tenant", async function () {
      const getMedia = sandbox
        .stub(MediaManager, "getMedia")
        .resolves(documentFixture());

      await MediaReferenceGuard.assertTenantStorable(
        tenantWith(mediaReference(MEDIA)),
        TENANT,
        USER,
      );

      assert.deepStrictEqual(getMedia.firstCall.args, [MEDIA, TENANT]);
    });

    // Neither a foreign tenant's medium nor an instance medium exists in the
    // tenant-scoped lookup, so both are refused like any unknown one — the
    // scope separation runs in both directions.
    for (const foreign of ["other-tenant-media", "instance-media"]) {
      it(`rejects ${foreign} — it is not the tenant's own`, async function () {
        const getMedia = sandbox.stub(MediaManager, "getMedia").resolves(null);

        await assert.rejects(
          MediaReferenceGuard.assertTenantStorable(
            tenantWith(mediaReference(foreign)),
            TENANT,
            USER,
          ),
          { statusCode: 400, code: "media_reference_unknown" },
        );
        assert.deepStrictEqual(getMedia.firstCall.args, [foreign, TENANT]);
      });
    }

    it("rejects an intern medium — a legal document is public by nature", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(documentFixture({ visibility: "intern" }));

      await assert.rejects(
        MediaReferenceGuard.assertTenantStorable(
          tenantWith(mediaReference(MEDIA)),
          TENANT,
          PICKER,
        ),
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, "media_reference_not_public");
          return true;
        },
      );
    });

    it("rejects a saver whose reach does not cover the medium", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(documentFixture());

      await assert.rejects(
        MediaReferenceGuard.assertTenantStorable(
          tenantWith(mediaReference(MEDIA)),
          TENANT,
          NO_PICKER,
        ),
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          return true;
        },
      );
    });

    it("takes the scope from the caller, not from the payload", async function () {
      const getMedia = sandbox
        .stub(MediaManager, "getMedia")
        .resolves(documentFixture());
      const forged = tenantWith(mediaReference(MEDIA));
      forged.id = "other-tenant";

      await MediaReferenceGuard.assertTenantStorable(forged, TENANT, PICKER);

      assert.deepStrictEqual(getMedia.firstCall.args, [MEDIA, TENANT]);
    });

    it("leaves external references alone", async function () {
      const getMedia = sandbox.stub(MediaManager, "getMedia");

      await MediaReferenceGuard.assertTenantStorable(
        tenantWith(externalReference("https://example.org/agb.pdf")),
        TENANT,
        USER,
      );

      assert.strictEqual(getMedia.called, false);
    });
  });

  describe("deletion protection", function () {
    it("finds the tenant by its legal documents", async function () {
      sandbox
        .stub(TenantModel, "findOne")
        .returns({ lean: async () => ({ id: TENANT, name: "Stadt" }) });

      const sites = await TenantManager.getMediaUsage(TENANT, MEDIA);

      assert.deepStrictEqual(sites, [{ id: TENANT, title: "Stadt" }]);
      assert.deepStrictEqual(TenantModel.findOne.firstCall.args[0], {
        id: TENANT,
        "legalDocuments.reference.mediaId": MEDIA,
      });
    });

    it("reports an unreferenced medium as unused", async function () {
      sandbox.stub(TenantModel, "findOne").returns({ lean: async () => null });

      assert.deepStrictEqual(
        await TenantManager.getMediaUsage(TENANT, MEDIA),
        [],
      );
    });

    it("searches no tenant at all for an instance medium", async function () {
      // `findUsage` runs with `tenantId: null` for instance media — searching
      // across all tenants would be the wrong answer, not a wider one.
      const findOne = sandbox.stub(TenantModel, "findOne");

      assert.deepStrictEqual(
        await TenantManager.getMediaUsage(null, MEDIA),
        [],
      );
      assert.strictEqual(findOne.called, false);
    });

    it("answers without a medium", async function () {
      const findOne = sandbox.stub(TenantModel, "findOne");

      assert.deepStrictEqual(
        await TenantManager.getMediaUsage(TENANT, null),
        [],
      );
      assert.strictEqual(findOne.called, false);
    });
  });
});
