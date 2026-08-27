const assert = require("assert");
const sinon = require("sinon");
const axios = require("axios");

const MediaManager = require("../src/commons/data-managers/media-manager");
const MediaService = require("../src/commons/services/media/media-service");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const PermissionService = require("../src/commons/services/permission-service");
const BookingService = require("../src/commons/services/checkout/booking-service");
const HtmlEngine = require("../src/platform/html-engine/html-engine");
const {
  embedMediaImages,
} = require("../src/commons/services/media/mail-media");
const { Bookable } = require("../src/commons/entities/bookable/bookable");
const { Event } = require("../src/commons/entities/event/event");
const { Media } = require("../src/commons/entities/media/media");

const TENANT = "tenant1";
const USER = "admin@stadt.de";
const BACKEND_URL = "https://booking.example.org";

function mediaReference(mediaId) {
  return { source: "media", mediaId, url: null };
}

function externalReference(url) {
  return { source: "external", mediaId: null, url };
}

function imageFixture(overrides = {}) {
  return new Media({
    id: "media-1",
    tenantId: TENANT,
    kind: "image",
    mimeType: "image/png",
    size: 1024,
    originalFileName: "room.png",
    title: "Room",
    visibility: "public",
    storage: { provider: "nextcloud", key: `${TENANT}/media/media-1/room.png` },
    ...overrides,
  });
}

function bookableFixture(overrides = {}) {
  return new Bookable({
    id: "bookable-1",
    tenantId: TENANT,
    type: "room",
    title: "Meeting room 1",
    ...overrides,
  });
}

function eventFixture(overrides = {}) {
  return new Event({
    id: "event-1",
    tenantId: TENANT,
    information: { name: "Summer party" },
    eventOrganizer: { name: "City" },
    ...overrides,
  });
}

describe("media references at bookables and events", function () {
  let sandbox;
  let backendUrl;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    backendUrl = process.env.BACKEND_URL;
    process.env.BACKEND_URL = BACKEND_URL;
  });

  afterEach(function () {
    sandbox.restore();
    process.env.BACKEND_URL = backendUrl;
  });

  describe("cover image", function () {
    it("takes the first reference of the image list", function () {
      const bookable = bookableFixture({
        images: [mediaReference("media-1"), mediaReference("media-2")],
      });

      assert.strictEqual(
        bookable.exportPublic().imgUrl,
        `/api/v2/${TENANT}/media/media-1/file`,
      );
    });

    it("follows the list when it is reordered — there is no cover field", function () {
      const bookable = bookableFixture({
        images: [mediaReference("media-1"), mediaReference("media-2")],
      });

      bookable.images.reverse();

      assert.strictEqual(
        bookable.exportPublic().imgUrl,
        `/api/v2/${TENANT}/media/media-2/file`,
      );
    });

    it("is empty for an empty image list", function () {
      assert.strictEqual(bookableFixture().exportPublic().imgUrl, "");
    });

    it("falls back to the legacy imgUrl until the media import ran", function () {
      const bookable = bookableFixture({
        imgUrl: "https://old.example.org/room.png",
      });

      assert.strictEqual(
        bookable.exportPublic().imgUrl,
        "https://old.example.org/room.png",
      );
    });

    it("shows only the cover image in the HTML markup", function () {
      const bookable = bookableFixture({
        images: [mediaReference("media-1"), mediaReference("media-2")],
      });

      const html = HtmlEngine.generateImageHtml(
        bookable.coverImageUrl,
        "cover-image",
        bookable.title,
      );

      assert.strictEqual(
        html,
        `<img src="/api/v2/${TENANT}/media/media-1/file" class="cover-image"  alt="Meeting room 1"/>`,
      );
    });
  });

  describe("export enrichment", function () {
    it("adds the delivery url to every reference of the image list", function () {
      const exported = bookableFixture({
        images: [
          mediaReference("media-1"),
          externalReference("https://other.example.org/pic.jpg"),
        ],
      }).exportPublic();

      assert.deepStrictEqual(exported.images, [
        {
          source: "media",
          mediaId: "media-1",
          url: `/api/v2/${TENANT}/media/media-1/file`,
        },
        {
          source: "external",
          mediaId: null,
          url: "https://other.example.org/pic.jpg",
        },
      ]);
    });

    it("keeps the context fields of an attachment and resolves its reference", function () {
      const exported = bookableFixture({
        attachments: [
          {
            id: "attachment-1",
            title: "House rules",
            type: "document",
            reference: mediaReference("media-9"),
            mailAttach: true,
          },
        ],
      }).exportPublic();

      assert.strictEqual(exported.attachments[0].title, "House rules");
      assert.strictEqual(exported.attachments[0].mailAttach, true);
      assert.strictEqual(
        exported.attachments[0].url,
        `/api/v2/${TENANT}/media/media-9/file`,
      );
    });

    it("derives the teaser image of an event without changing its structure", function () {
      const exported = eventFixture({
        information: {
          name: "Summer party",
          teaserImage: mediaReference("media-3"),
        },
        eventOrganizer: {
          name: "City",
          contactPersonImage: mediaReference("media-4"),
        },
      }).exportPublic();

      assert.strictEqual(
        exported.information.teaserImage,
        `/api/v2/${TENANT}/media/media-3/file`,
      );
      assert.strictEqual(exported.information.name, "Summer party");
      assert.strictEqual(
        exported.eventOrganizer.contactPersonImage,
        `/api/v2/${TENANT}/media/media-4/file`,
      );
    });

    it("derives the image list and the speaker photos of an event", function () {
      const exported = eventFixture({
        images: [
          mediaReference("media-5"),
          externalReference("https://other.example.org/pic.jpg"),
        ],
        eventOrganizer: {
          name: "City",
          speakers: [
            { name: "Jane Doe", image: mediaReference("media-6") },
            { name: "John Doe" },
          ],
        },
      }).exportPublic();

      assert.deepStrictEqual(exported.images, [
        `/api/v2/${TENANT}/media/media-5/file`,
        "https://other.example.org/pic.jpg",
      ]);
      assert.deepStrictEqual(exported.eventOrganizer.speakers, [
        { name: "Jane Doe", image: `/api/v2/${TENANT}/media/media-6/file` },
        { name: "John Doe", image: "" },
      ]);
    });

    it("exports an empty image list as an empty list", function () {
      assert.deepStrictEqual(eventFixture().exportPublic().images, []);
    });

    it("passes a legacy plain url of an event through untouched", function () {
      const exported = eventFixture({
        information: {
          name: "Summer party",
          teaserImage: "https://old.example.org/teaser.png",
        },
      }).exportPublic();

      assert.strictEqual(
        exported.information.teaserImage,
        "https://old.example.org/teaser.png",
      );
    });
  });

  describe("reference validation on save", function () {
    it("rejects a medium that does not belong to the tenant", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(null);

      await assert.rejects(
        MediaReferenceGuard.assertBookableStorable(
          bookableFixture({ images: [mediaReference("media-1")] }),
          USER,
        ),
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, "media_reference_unknown");
          return true;
        },
      );
    });

    it("rejects a saver without the picker right", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(imageFixture());
      sandbox.stub(PermissionService, "_allowRead").resolves(false);

      await assert.rejects(
        MediaReferenceGuard.assertBookableStorable(
          bookableFixture({ images: [mediaReference("media-1")] }),
          USER,
        ),
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          return true;
        },
      );
    });

    it("rejects an intern medium in a public context", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(imageFixture({ visibility: "intern" }));
      sandbox.stub(PermissionService, "_allowRead").resolves(true);

      await assert.rejects(
        MediaReferenceGuard.assertBookableStorable(
          bookableFixture({
            isPublic: true,
            images: [mediaReference("media-1")],
          }),
          USER,
        ),
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, "media_reference_not_public");
          return true;
        },
      );
    });

    it("allows an intern medium at a bookable that is not public", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(imageFixture({ visibility: "intern" }));
      sandbox.stub(PermissionService, "_allowRead").resolves(true);

      await MediaReferenceGuard.assertBookableStorable(
        bookableFixture({ images: [mediaReference("media-1")] }),
        USER,
      );
    });

    it("checks every image site and the attachments of an event", async function () {
      const getMedia = sandbox
        .stub(MediaManager, "getMedia")
        .resolves(imageFixture());
      sandbox.stub(PermissionService, "_allowRead").resolves(true);

      await MediaReferenceGuard.assertEventStorable(
        eventFixture({
          information: {
            name: "Summer party",
            teaserImage: mediaReference("media-1"),
          },
          eventOrganizer: {
            name: "City",
            contactPersonImage: mediaReference("media-2"),
            speakers: [{ name: "Jane Doe", image: mediaReference("media-4") }],
          },
          images: [mediaReference("media-5")],
          attachments: [{ id: "a1", reference: mediaReference("media-3") }],
        }),
        TENANT,
        USER,
      );

      assert.deepStrictEqual(
        getMedia.getCalls().map((call) => call.args[0]),
        ["media-1", "media-2", "media-4", "media-5", "media-3"],
      );
    });

    it("rejects a medium of another tenant in the image list of an event", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(null);

      await assert.rejects(
        MediaReferenceGuard.assertEventStorable(
          eventFixture({ images: [mediaReference("media-5")] }),
          TENANT,
          USER,
        ),
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, "media_reference_unknown");
          return true;
        },
      );
    });

    it("rejects an intern speaker photo at a public event", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(imageFixture({ visibility: "intern" }));
      sandbox.stub(PermissionService, "_allowRead").resolves(true);

      await assert.rejects(
        MediaReferenceGuard.assertEventStorable(
          eventFixture({
            isPublic: true,
            eventOrganizer: {
              name: "City",
              speakers: [
                { name: "Jane Doe", image: mediaReference("media-4") },
              ],
            },
          }),
          TENANT,
          USER,
        ),
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, "media_reference_not_public");
          return true;
        },
      );
    });

    it("allows an intern speaker photo at an event that is not public", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(imageFixture({ visibility: "intern" }));
      sandbox.stub(PermissionService, "_allowRead").resolves(true);

      await MediaReferenceGuard.assertEventStorable(
        eventFixture({
          eventOrganizer: {
            name: "City",
            speakers: [{ name: "Jane Doe", image: mediaReference("media-4") }],
          },
        }),
        TENANT,
        USER,
      );
    });

    it("leaves external references alone", async function () {
      const getMedia = sandbox.stub(MediaManager, "getMedia");

      await MediaReferenceGuard.assertBookableStorable(
        bookableFixture({
          isPublic: true,
          images: [externalReference("https://other.example.org/pic.jpg")],
        }),
        USER,
      );

      assert.strictEqual(getMedia.called, false);
    });
  });

  describe("mail attachments", function () {
    it("reads an intern medium through the media service, not over HTTP", async function () {
      const media = imageFixture({
        visibility: "intern",
        kind: "document",
        mimeType: "application/pdf",
        originalFileName: "house-rules.pdf",
      });
      sandbox.stub(MediaManager, "getMedia").resolves(media);
      sandbox.stub(MediaService, "getBuffer").resolves(Buffer.from("bytes"));
      const get = sandbox.stub(axios, "get");

      const prepared = await BookingService.prepareMailAttachments(
        [
          {
            title: "House rules",
            mailAttach: true,
            reference: mediaReference("media-1"),
          },
        ],
        TENANT,
      );

      assert.strictEqual(get.called, false);
      assert.deepStrictEqual(prepared, [
        {
          filename: "House_rules.pdf",
          content: Buffer.from("bytes"),
          contentType: "application/pdf",
        },
      ]);
    });

    it("still downloads an external reference over HTTP", async function () {
      sandbox.stub(axios, "get").resolves({
        data: Buffer.from("bytes"),
        headers: { "content-type": "application/pdf" },
      });

      const prepared = await BookingService.prepareMailAttachments(
        [
          {
            title: "Terms",
            mailAttach: true,
            reference: externalReference("https://other.example.org/terms.pdf"),
          },
        ],
        TENANT,
      );

      assert.strictEqual(prepared.length, 1);
      assert.strictEqual(prepared[0].filename, "Terms.pdf");
    });

    it("sends the same medium only once", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(
        imageFixture({
          kind: "document",
          mimeType: "application/pdf",
          originalFileName: "house-rules.pdf",
        }),
      );
      const getBuffer = sandbox
        .stub(MediaService, "getBuffer")
        .resolves(Buffer.from("bytes"));

      const attachment = {
        title: "House rules",
        mailAttach: true,
        reference: mediaReference("media-1"),
      };

      const prepared = await BookingService.prepareMailAttachments(
        [attachment, { ...attachment }],
        TENANT,
      );

      assert.strictEqual(prepared.length, 1);
      assert.strictEqual(getBuffer.callCount, 1);
    });

    it("skips attachments that are not flagged for the mail", async function () {
      const getMedia = sandbox.stub(MediaManager, "getMedia");

      const prepared = await BookingService.prepareMailAttachments(
        [{ title: "House rules", reference: mediaReference("media-1") }],
        TENANT,
      );

      assert.deepStrictEqual(prepared, []);
      assert.strictEqual(getMedia.called, false);
    });
  });

  describe("media images in mails", function () {
    it("embeds a public image in mail size", async function () {
      sandbox.stub(MediaManager, "getMedia").resolves(imageFixture());

      const html = await embedMediaImages(
        `<p><img src="/api/v2/${TENANT}/media/media-1/file" alt="Room"/></p>`,
        TENANT,
      );

      assert.strictEqual(
        html,
        `<p><img src="${BACKEND_URL}/api/v2/${TENANT}/media/media-1/file?size=sm" alt="Room"/></p>`,
      );
    });

    it("links an intern image instead of embedding it", async function () {
      sandbox
        .stub(MediaManager, "getMedia")
        .resolves(imageFixture({ visibility: "intern" }));

      const html = await embedMediaImages(
        `<img src="/api/v2/${TENANT}/media/media-1/file" alt="Floor plan"/>`,
        TENANT,
      );

      assert.strictEqual(
        html,
        `<a href="${BACKEND_URL}/api/v2/${TENANT}/media/media-1/file">Floor plan</a>`,
      );
    });

    it("leaves images of another tenant untouched", async function () {
      const getMedia = sandbox.stub(MediaManager, "getMedia");
      const source = `<img src="/api/v2/other-tenant/media/media-1/file"/>`;

      assert.strictEqual(await embedMediaImages(source, TENANT), source);
      assert.strictEqual(getMedia.called, false);
    });

    it("leaves images that are not media untouched", async function () {
      const getMedia = sandbox.stub(MediaManager, "getMedia");
      const source = `<img src="https://old.example.org/logo.png"/>`;

      assert.strictEqual(await embedMediaImages(source, TENANT), source);
      assert.strictEqual(getMedia.called, false);
    });
  });
});
