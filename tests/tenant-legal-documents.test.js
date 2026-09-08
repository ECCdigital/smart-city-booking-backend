const assert = require("assert");
const {
  LEGAL_DOCUMENT_TYPE,
  getLegalDocumentsError,
} = require("../src/commons/utilities/legal-documents");
const Tenant = require("../src/commons/entities/tenant/tenant");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");

function mediaReference(mediaId = "media-1") {
  return { source: "media", mediaId, url: null };
}

function legalDocument(type, overrides = {}) {
  return { type, title: "", reference: mediaReference(), ...overrides };
}

describe("getLegalDocumentsError", function () {
  it("accepts an empty list", function () {
    assert.strictEqual(getLegalDocumentsError([]), null);
  });

  it("accepts one entry per known type", function () {
    const documents = Object.values(LEGAL_DOCUMENT_TYPE)
      .filter((type) => type !== LEGAL_DOCUMENT_TYPE.OTHER)
      .map((type) => legalDocument(type));

    assert.strictEqual(getLegalDocumentsError(documents), null);
  });

  it("accepts several other documents with distinct titles", function () {
    const documents = [
      legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: "House rules" }),
      legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: "Fire safety" }),
    ];

    assert.strictEqual(getLegalDocumentsError(documents), null);
  });

  it("rejects a value that is not an array", function () {
    assert.ok(getLegalDocumentsError(undefined));
    assert.ok(getLegalDocumentsError(null));
    assert.ok(getLegalDocumentsError({}));
  });

  it("rejects an entry that is not an object", function () {
    assert.ok(getLegalDocumentsError(["dataProtection"]));
    assert.ok(getLegalDocumentsError([null]));
    assert.ok(getLegalDocumentsError([[]]));
  });

  it("rejects an unknown type", function () {
    assert.ok(getLegalDocumentsError([legalDocument("houseRules")]));
    assert.ok(getLegalDocumentsError([legalDocument(undefined)]));
  });

  it("requires a title on other", function () {
    assert.ok(
      getLegalDocumentsError([legalDocument(LEGAL_DOCUMENT_TYPE.OTHER)]),
      "empty title must be rejected",
    );
    assert.ok(
      getLegalDocumentsError([
        legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: "   " }),
      ]),
      "whitespace-only title must be rejected",
    );
    assert.ok(
      getLegalDocumentsError([
        legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: 7 }),
      ]),
      "non-string title must be rejected",
    );
  });

  it("forbids a title on a known type", function () {
    assert.ok(
      getLegalDocumentsError([
        legalDocument(LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS, {
          title: "Our terms",
        }),
      ]),
    );
  });

  it("allows a missing title on a known type", function () {
    const [entry] = [legalDocument(LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE)];
    delete entry.title;

    assert.strictEqual(getLegalDocumentsError([entry]), null);
  });

  it("rejects two entries of the same known type", function () {
    const documents = [
      legalDocument(LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS),
      legalDocument(LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS, {
        reference: mediaReference("media-2"),
      }),
    ];

    assert.ok(getLegalDocumentsError(documents));
  });

  it("rejects two other entries with the same title", function () {
    const documents = [
      legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: "House rules" }),
      legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: "House rules" }),
    ];

    assert.ok(getLegalDocumentsError(documents));
  });

  it("compares other titles trimmed", function () {
    const documents = [
      legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: "House rules" }),
      legalDocument(LEGAL_DOCUMENT_TYPE.OTHER, { title: "  House rules  " }),
    ];

    assert.ok(getLegalDocumentsError(documents));
  });

  it("rejects a malformed reference", function () {
    assert.ok(
      getLegalDocumentsError([
        legalDocument(LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE, {
          reference: { source: "media", mediaId: "media-1", url: "https://x" },
        }),
      ]),
      "a reference may not carry both mediaId and url",
    );
    assert.ok(
      getLegalDocumentsError([
        legalDocument(LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE, {
          reference: { source: "media", mediaId: null, url: null },
        }),
      ]),
      "a media reference needs a mediaId",
    );
  });

  it("accepts an external reference", function () {
    assert.strictEqual(
      getLegalDocumentsError([
        legalDocument(LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS, {
          reference: { source: "external", url: "https://example.org/agb.pdf" },
        }),
      ]),
      null,
    );
  });

  it("accepts a document without a reference", function () {
    const entry = legalDocument(LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE);
    delete entry.reference;

    assert.strictEqual(getLegalDocumentsError([entry]), null);
  });
});

describe("Tenant legalDocuments", function () {
  it("defaults to an empty list", function () {
    const tenant = new Tenant({ id: "tenant-1", name: "Tenant" });

    assert.deepStrictEqual(tenant.legalDocuments, []);
  });

  it("keeps the documents it was created with", function () {
    const documents = [legalDocument(LEGAL_DOCUMENT_TYPE.DATA_PROTECTION)];
    const tenant = Tenant.create({
      id: "tenant-1",
      name: "Tenant",
      legalDocuments: documents,
    });

    assert.deepStrictEqual(tenant.legalDocuments, documents);
  });

  it("rejects a tenant with two terms and conditions", function () {
    assert.throws(() =>
      Tenant.create({
        id: "tenant-1",
        name: "Tenant",
        legalDocuments: [
          legalDocument(LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS),
          legalDocument(LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS),
        ],
      }),
    );
  });

  it("rejects a tenant whose reference the model would reject", function () {
    assert.throws(() =>
      Tenant.create({
        id: "tenant-1",
        name: "Tenant",
        legalDocuments: [
          legalDocument(LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE, {
            reference: { source: "media", mediaId: null, url: "https://x" },
          }),
        ],
      }),
    );
  });

  it("rejects a tenant with an untitled other document", function () {
    assert.throws(() =>
      Tenant.create({
        id: "tenant-1",
        name: "Tenant",
        legalDocuments: [legalDocument(LEGAL_DOCUMENT_TYPE.OTHER)],
      }),
    );
  });
});

describe("tenantSchema legalDocuments", function () {
  function tenantDocument(legalDocuments) {
    return new TenantModel({ id: "tenant-1", name: "Tenant", legalDocuments });
  }

  it("stores the documents as typed subdocuments", async function () {
    const doc = tenantDocument([
      {
        type: LEGAL_DOCUMENT_TYPE.OTHER,
        title: "House rules",
        reference: mediaReference(),
      },
    ]);

    await doc.validate();

    const [stored] = doc.legalDocuments;
    assert.strictEqual(stored.type, LEGAL_DOCUMENT_TYPE.OTHER);
    assert.strictEqual(stored.title, "House rules");
    assert.strictEqual(stored.reference.mediaId, "media-1");
    assert.strictEqual(stored._id, undefined);
  });

  it("defaults title to an empty string", async function () {
    const doc = tenantDocument([
      {
        type: LEGAL_DOCUMENT_TYPE.DATA_PROTECTION,
        reference: mediaReference(),
      },
    ]);

    await doc.validate();

    assert.strictEqual(doc.legalDocuments[0].title, "");
  });

  it("defaults to an empty list", function () {
    assert.deepStrictEqual(
      new TenantModel({ id: "tenant-1", name: "Tenant" }).legalDocuments.length,
      0,
    );
  });

  it("rejects an unknown type", async function () {
    const doc = tenantDocument([
      { type: "houseRules", reference: mediaReference() },
    ]);

    await assert.rejects(() => doc.validate());
  });

  it("rejects a reference carrying both mediaId and url", async function () {
    const doc = tenantDocument([
      {
        type: LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE,
        reference: { source: "media", mediaId: "media-1", url: "https://x.de" },
      },
    ]);

    await assert.rejects(() => doc.validate());
  });

  it("accepts an external reference", async function () {
    const doc = tenantDocument([
      {
        type: LEGAL_DOCUMENT_TYPE.TERMS_AND_CONDITIONS,
        reference: { source: "external", url: "https://example.org/agb.pdf" },
      },
    ]);

    await doc.validate();

    assert.strictEqual(doc.legalDocuments[0].reference.source, "external");
  });

  it("rejects a duplicate known type", async function () {
    const doc = tenantDocument([
      { type: LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE, reference: mediaReference() },
      {
        type: LEGAL_DOCUMENT_TYPE.LEGAL_NOTICE,
        reference: mediaReference("media-2"),
      },
    ]);

    await assert.rejects(() => doc.validate());
  });

  it("rejects an untitled other document", async function () {
    const doc = tenantDocument([
      { type: LEGAL_DOCUMENT_TYPE.OTHER, reference: mediaReference() },
    ]);

    await assert.rejects(() => doc.validate());
  });
});
