const assert = require("assert");
const sinon = require("sinon");
const sharp = require("sharp");

const BookingManager = require("../src/commons/data-managers/booking-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MediaManager = require("../src/commons/data-managers/media-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const storage = require("../src/commons/services/storage");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  NextcloudManager,
} = require("../src/commons/data-managers/file-manager");
const {
  runImport,
  rewriteReferences,
} = require("../src/commons/services/media/media-import");
const {
  resetImportStatus,
  warnIfImportPending,
} = require("../src/commons/services/media/media-import-status");

const TENANT = "tenant1";
const LOGO_PATH = "/public/logos/logo.png";
const RECEIPT_PATH = "/receipts/invoice-1.pdf";

/**
 * A stored legacy address as an old installation wrote it: the host of the
 * environment it was uploaded in, baked in.
 *
 * @param {string} host - Host the address was written under.
 * @param {string} tenantId - Tenant of the address, empty for the instance.
 * @param {string} legacyPath - Path the file had.
 * @returns {string}
 */
function legacyUrl(host, tenantId, legacyPath) {
  const scope = tenantId ? `${tenantId}/` : "";
  return `${host}/api/${scope}files/get?name=${encodeURIComponent(legacyPath)}`;
}

describe("media migration", () => {
  let sandbox;
  let mediaStore;
  let provider;
  let trees;
  let png;

  before(async () => {
    png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mediaStore = new Map();

    provider = {
      name: "nextcloud",
      put: sandbox.stub().resolves(),
      getBuffer: sandbox.stub().resolves(Buffer.alloc(0)),
      getStream: sandbox.stub(),
      stat: sandbox.stub().resolves({ size: 1 }),
      delete: sandbox.stub().resolves(),
      deleteMany: sandbox.stub().resolves(),
    };

    sandbox.stub(storage, "configuredProviderName").returns("nextcloud");
    sandbox.stub(storage, "getStorageProvider").returns(provider);

    // The legacy trees, keyed by `tenantId|root`.
    trees = new Map();

    sandbox
      .stub(NextcloudManager, "getFiles")
      .callsFake(async ({ tenant, rootPath }) =>
        (trees.get(`${tenant || ""}|${rootPath}`) || []).map((filename) => ({
          filename,
          type: "file",
        })),
      );

    sandbox.stub(NextcloudManager, "getFile").resolves(png);

    sandbox
      .stub(MediaManager, "getMediaByLegacyPath")
      .callsFake(
        async (tenantId, legacyPath) =>
          mediaStore.get(`${tenantId ?? ""}|${legacyPath}`) || null,
      );

    sandbox.stub(MediaManager, "storeMedia").callsFake(async (media) => {
      if (media.legacyPath) {
        mediaStore.set(`${media.tenantId ?? ""}|${media.legacyPath}`, media);
      }
      return media;
    });

    sandbox.stub(TenantManager, "getTenants").resolves([{ id: TENANT }]);

    sandbox.stub(BookableManager, "getBookables").resolves([]);
    sandbox.stub(BookableManager, "storeBookable").resolves();
    sandbox.stub(EventManager, "getEvents").resolves([]);
    sandbox.stub(EventManager, "storeEvent").resolves();
    sandbox.stub(BookingManager, "getBookingsWithAttachments").resolves([]);
    sandbox.stub(BookingManager, "storeBooking").resolves();
    sandbox
      .stub(BookingManager, "getBookingsByAttachmentFileName")
      .resolves([]);
    sandbox.stub(InstanceManager, "getInstance").resolves(null);
    sandbox.stub(InstanceManager, "updateInstance").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("import", () => {
    beforeEach(() => {
      trees.set(`${TENANT}|public`, [LOGO_PATH]);
    });

    it("turns a legacy file into a medium with its folder as a tag", async () => {
      const { report } = await runImport();

      assert.strictEqual(report.errors.length, 0);

      const media = mediaStore.get(`${TENANT}|${LOGO_PATH}`);
      assert.ok(media, "the file became a medium");
      assert.strictEqual(media.legacyPath, LOGO_PATH);
      assert.deepStrictEqual(media.tags, ["logos"]);
      assert.strictEqual(media.visibility, "public");
      assert.strictEqual(media.uploadedBy, null);
    });

    it("imports a protected file as an internal medium", async () => {
      trees.set(`${TENANT}|protected`, ["/protected/secret.png"]);

      await runImport();

      const media = mediaStore.get(`${TENANT}|/protected/secret.png`);
      assert.strictEqual(media.visibility, "intern");
    });

    it("changes nothing on a second run", async () => {
      await runImport();
      provider.put.resetHistory();

      const { steps } = await runImport();
      const [mediaStep] = steps;

      assert.strictEqual(mediaStep.processed, 0);
      assert.strictEqual(mediaStep.skipped, 1);
      assert.strictEqual(provider.put.callCount, 0);
    });

    it("writes nothing in a dry run", async () => {
      const { steps } = await runImport({ dryRun: true });
      const [mediaStep] = steps;

      assert.strictEqual(mediaStep.processed, 1);
      assert.strictEqual(provider.put.callCount, 0);
      assert.strictEqual(mediaStore.size, 0);
    });
  });

  describe("booking documents", () => {
    beforeEach(() => {
      trees.set(`${TENANT}|receipts`, [RECEIPT_PATH]);
    });

    it("becomes one medium referencing every booking whose attachment names it", async () => {
      BookingManager.getBookingsByAttachmentFileName
        .withArgs(TENANT, "invoice-1.pdf")
        .resolves([{ id: "booking-1" }, { id: "booking-2" }]);

      await runImport();

      const documents = MediaManager.storeMedia
        .getCalls()
        .map((call) => call.args[0])
        .filter((media) => (media.bookingIds || []).length > 0);

      assert.strictEqual(documents.length, 1);
      assert.deepStrictEqual(documents[0].bookingIds, [
        "booking-1",
        "booking-2",
      ]);
    });

    it("totals its steps without repeating what they reported", async () => {
      const { report, steps } = await runImport();

      assert.strictEqual(
        report.orphans.length,
        steps.reduce((sum, step) => sum + step.orphans.length, 0),
      );
      // The parts carry the detail; a printer must not list it twice.
      assert.strictEqual(report.isRollUp, true);
      assert.strictEqual(
        steps.every((step) => step.isRollUp === false),
        true,
      );
    });

    it("reports a document no attachment names instead of guessing", async () => {
      const { steps } = await runImport();
      const [, documentStep] = steps;

      assert.strictEqual(documentStep.processed, 0);
      assert.strictEqual(documentStep.orphans.length, 1);
      assert.match(documentStep.orphans[0].subject, /invoice-1\.pdf$/);
      assert.strictEqual(mediaStore.size, 0);
    });
  });

  describe("reference rewriting", () => {
    /**
     * Puts an imported medium in place of a legacy path.
     *
     * @param {string|null} tenantId - Tenant of the medium.
     * @param {string} legacyPath - Path it was imported from.
     * @param {string} id - Id of the medium.
     */
    function imported(tenantId, legacyPath, id) {
      mediaStore.set(`${tenantId ?? ""}|${legacyPath}`, {
        id,
        tenantId,
        legacyPath,
      });
    }

    it("resolves a stored address whatever host it names", async () => {
      imported(TENANT, LOGO_PATH, "media-1");

      const bookable = {
        id: "bookable-1",
        tenantId: TENANT,
        imgUrl: legacyUrl("https://long-gone.example", TENANT, LOGO_PATH),
        images: [],
        attachments: [],
      };

      BookableManager.getBookables.resolves([bookable]);

      await rewriteReferences();

      assert.deepStrictEqual(bookable.images, [
        { source: "media", mediaId: "media-1" },
      ]);
      assert.strictEqual(BookableManager.storeBookable.callCount, 1);
    });

    it("keeps an address that is not ours an external reference", async () => {
      const bookable = {
        id: "bookable-1",
        tenantId: TENANT,
        imgUrl: "https://picsum.photos/200",
        images: [],
        attachments: [],
      };

      BookableManager.getBookables.resolves([bookable]);

      await rewriteReferences();

      assert.deepStrictEqual(bookable.images, [
        { source: "external", url: "https://picsum.photos/200" },
      ]);
    });

    it("never resolves an instance file into a tenant entity", async () => {
      imported(null, LOGO_PATH, "instance-media-1");

      const bookable = {
        id: "bookable-1",
        tenantId: TENANT,
        imgUrl: legacyUrl("https://booking.example", "", LOGO_PATH),
        images: [],
        attachments: [],
      };

      BookableManager.getBookables.resolves([bookable]);

      await rewriteReferences();

      assert.strictEqual(bookable.images[0].source, "external");
    });

    it("converts the image list and the speaker photos of an event", async () => {
      imported(TENANT, LOGO_PATH, "media-1");

      const event = {
        id: "event-1",
        tenantId: TENANT,
        information: {},
        eventOrganizer: {
          speakers: [
            {
              name: "Jane Doe",
              image: legacyUrl("https://long-gone.example", TENANT, LOGO_PATH),
            },
          ],
        },
        images: [
          legacyUrl("http://localhost:8080", TENANT, LOGO_PATH),
          "https://picsum.photos/200",
        ],
        attachments: [],
      };

      EventManager.getEvents.resolves([event]);

      await rewriteReferences();

      assert.deepStrictEqual(event.images, [
        { source: "media", mediaId: "media-1" },
        { source: "external", url: "https://picsum.photos/200" },
      ]);
      assert.deepStrictEqual(event.eventOrganizer.speakers[0].image, {
        source: "media",
        mediaId: "media-1",
      });
      assert.strictEqual(EventManager.storeEvent.callCount, 1);
    });

    it("changes nothing on a second run over the same event", async () => {
      imported(TENANT, LOGO_PATH, "media-1");

      const event = {
        id: "event-1",
        tenantId: TENANT,
        information: {},
        eventOrganizer: {
          speakers: [
            {
              name: "Jane Doe",
              image: legacyUrl("https://long-gone.example", TENANT, LOGO_PATH),
            },
          ],
        },
        images: [legacyUrl("http://localhost:8080", TENANT, LOGO_PATH)],
        attachments: [],
      };

      EventManager.getEvents.resolves([event]);

      await rewriteReferences();
      const converted = JSON.parse(JSON.stringify(event));

      const report = await rewriteReferences();

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(EventManager.storeEvent.callCount, 1);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(event)), converted);
    });

    it("converts the attachment copies on bookings", async () => {
      imported(TENANT, "/public/terms.pdf", "media-2");

      const booking = {
        id: "booking-1",
        tenantId: TENANT,
        attachments: [
          {
            id: "a1",
            title: "Terms",
            type: "terms",
            url: legacyUrl(
              "http://localhost:8080",
              TENANT,
              "/public/terms.pdf",
            ),
          },
        ],
      };

      BookingManager.getBookingsWithAttachments.resolves([booking]);

      await rewriteReferences();

      assert.deepStrictEqual(booking.attachments[0].reference, {
        source: "media",
        mediaId: "media-2",
      });
      assert.strictEqual(BookingManager.storeBooking.callCount, 1);
    });

    it("leaves an already converted entity alone", async () => {
      imported(TENANT, LOGO_PATH, "media-1");

      const bookable = {
        id: "bookable-1",
        tenantId: TENANT,
        imgUrl: legacyUrl("https://booking.example", TENANT, LOGO_PATH),
        images: [{ source: "media", mediaId: "media-1" }],
        attachments: [],
      };

      BookableManager.getBookables.resolves([bookable]);

      const report = await rewriteReferences();

      assert.strictEqual(report.processed, 0);
      assert.strictEqual(BookableManager.storeBookable.callCount, 0);
    });

    it("writes nothing in a dry run", async () => {
      imported(TENANT, LOGO_PATH, "media-1");

      const bookable = {
        id: "bookable-1",
        tenantId: TENANT,
        imgUrl: legacyUrl("https://booking.example", TENANT, LOGO_PATH),
        images: [],
        attachments: [],
      };

      BookableManager.getBookables.resolves([bookable]);

      const report = await rewriteReferences({ dryRun: true });

      assert.strictEqual(report.processed, 1);
      assert.strictEqual(BookableManager.storeBookable.callCount, 0);
    });

    it("converts the branding and legal documents of the instance", async () => {
      imported(null, "/public/logo.png", "instance-media-1");
      imported(null, "/protected/privacy.pdf", "instance-media-2");

      const instance = {
        branding: {
          logo: null,
          favicon: null,
          logoUrl: legacyUrl("https://booking.example", "", "/public/logo.png"),
          faviconUrl: "",
        },
        dataProtection: {
          source: "url",
          url: legacyUrl(
            "https://booking.example",
            "",
            "/protected/privacy.pdf",
          ),
          fileName: "privacy.pdf",
          reference: null,
        },
      };

      InstanceManager.getInstance.resolves(instance);

      await rewriteReferences();

      assert.deepStrictEqual(instance.branding.logo, {
        source: "media",
        mediaId: "instance-media-1",
      });
      assert.deepStrictEqual(instance.dataProtection.reference, {
        source: "media",
        mediaId: "instance-media-2",
      });
      assert.strictEqual(InstanceManager.updateInstance.callCount, 1);
    });
  });

  describe("boot warning", () => {
    let nextcloudUrl;

    beforeEach(() => {
      nextcloudUrl = process.env.NEXTCLOUD_URL;
      process.env.NEXTCLOUD_URL = "http://nextcloud.invalid";
      resetImportStatus();
      sandbox.stub(MediaManager, "countImportedMedia").resolves(0);
    });

    afterEach(() => {
      resetImportStatus();

      if (nextcloudUrl === undefined) {
        delete process.env.NEXTCLOUD_URL;
      } else {
        process.env.NEXTCLOUD_URL = nextcloudUrl;
      }
    });

    it("warns while no medium has been imported", async () => {
      assert.strictEqual(await warnIfImportPending(), true);
    });

    it("stays quiet once the import has run", async () => {
      MediaManager.countImportedMedia.resolves(3);

      assert.strictEqual(await warnIfImportPending(), false);
    });

    it("stays quiet without a legacy storage to migrate from", async () => {
      delete process.env.NEXTCLOUD_URL;

      assert.strictEqual(await warnIfImportPending(), false);
    });
  });
});
