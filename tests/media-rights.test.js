/**
 * The media rights (`services/media/media-rights.js`, ticket 04 of the
 * authorization architecture) against their interface: a bundle of decided
 * reaches, as `reachesOf(req)` packs it, and a medium. One `describe` per
 * kind of medium - the library, the booking document, the instance medium,
 * the public medium under supervision, the legacy file, the reference an
 * entity pins. Which entries a route names is the routes'
 * (`authorization-media-routes.test.js`).
 */

const { expect } = require("chai");
const sinon = require("sinon");

const MediaManager = require("../src/commons/data-managers/media-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const {
  MediaUsageService,
} = require("../src/commons/services/media/media-usage");
const MediaRights = require("../src/commons/services/media/media-rights");
const { Media } = require("../src/commons/entities/media/media");

const TENANT = "tenant-1";
const UPLOADER = "uploader@example.com";
const CUSTOMER = "customer@example.com";

function medium(overrides = {}) {
  return new Media({
    id: "m1",
    tenantId: TENANT,
    kind: "image",
    mimeType: "image/png",
    size: 7,
    originalFileName: "bild.png",
    uploadedBy: UPLOADER,
    visibility: "public",
    storage: { provider: "s3", key: "k" },
    ...overrides,
  });
}

function bookingDocument(overrides = {}) {
  return medium({
    kind: "document",
    mimeType: "application/pdf",
    originalFileName: "rechnung.pdf",
    uploadedBy: null,
    visibility: "intern",
    bookingIds: ["b1"],
    ...overrides,
  });
}

/** A bundle as `reachesOf(req)` packs it. */
const bundle = (userId, reaches = {}) => ({ userId, ...reaches });
const anonymous = bundle(null, { file: "public" });

/** What a verb answers: the medium's id, or `<status> <code>`. */
async function outcome(promise) {
  try {
    const media = await promise;
    return media?.id ?? "served";
  } catch (err) {
    return `${err.statusCode} ${err.code}`;
  }
}

describe("media rights", function () {
  let getMedia;
  let getTenant;

  beforeEach(function () {
    getMedia = sinon.stub(MediaManager, "getMedia").resolves(medium());
    getTenant = sinon
      .stub(TenantManager, "getTenant")
      .resolves({ id: TENANT, supervisionLevel: "free" });
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("the library", function () {
    it("loads the medium as the domain, in the tenant asked", async function () {
      await MediaRights.readable(
        "m1",
        TENANT,
        bundle(UPLOADER, { read: "any" }),
      );

      expect(getMedia.firstCall.args.slice(0, 2)).to.deep.equal(["m1", TENANT]);
      expect(getMedia.firstCall.args[2].reach).to.equal("domain");
    });

    it("reads, changes and deletes under any, and the own upload under own", async function () {
      for (const [verb, action] of [
        ["readable", "read"],
        ["updatable", "update"],
        ["deletable", "delete"],
      ]) {
        expect(
          await outcome(
            MediaRights[verb](
              "m1",
              TENANT,
              bundle(CUSTOMER, { [action]: "any" }),
            ),
          ),
          verb,
        ).to.equal("m1");
        expect(
          await outcome(
            MediaRights[verb](
              "m1",
              TENANT,
              bundle(UPLOADER, { [action]: "own" }),
            ),
          ),
          verb,
        ).to.equal("m1");
      }
    });

    it("answers a medium out of reach as not there", async function () {
      for (const [verb, action] of [
        ["readable", "read"],
        ["updatable", "update"],
        ["deletable", "delete"],
      ]) {
        expect(
          await outcome(
            MediaRights[verb](
              "m1",
              TENANT,
              bundle(CUSTOMER, { [action]: "own" }),
            ),
          ),
          verb,
        ).to.equal("404 media_not_found");
        expect(
          await outcome(MediaRights[verb]("m1", TENANT, bundle(CUSTOMER))),
          verb,
        ).to.equal("404 media_not_found");
      }
    });

    it("asks the entry of the verb, not another one", async function () {
      expect(
        await outcome(
          MediaRights.updatable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { read: "any" }),
          ),
        ),
      ).to.equal("404 media_not_found");
    });

    it("answers an unknown medium as not there, and the anonymous with 401", async function () {
      getMedia.resolves(null);
      expect(
        await outcome(
          MediaRights.readable(
            "nope",
            TENANT,
            bundle(CUSTOMER, { read: "any" }),
          ),
        ),
      ).to.equal("404 media_not_found");
      expect(
        await outcome(MediaRights.readable("m1", TENANT, anonymous)),
      ).to.equal("401 unauthorized");
    });

    it("serves an internal file to whoever reads the library or is a member", async function () {
      getMedia.resolves(medium({ visibility: "intern" }));

      expect(
        await outcome(MediaRights.fileReadable("m1", TENANT, anonymous)),
      ).to.equal("401 unauthorized");
      expect(
        await outcome(
          MediaRights.fileReadable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { file: "public" }),
          ),
        ),
      ).to.equal("403 forbidden");
      expect(
        await outcome(
          MediaRights.fileReadable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { file: "public", intern: "any" }),
          ),
        ),
      ).to.equal("m1");
      expect(
        await outcome(
          MediaRights.fileReadable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { file: "own" }),
          ),
        ),
      ).to.equal("m1");
    });
  });

  describe("the booking document", function () {
    const bookingOf = (assignedUserId) => ({
      id: "b1",
      tenantId: TENANT,
      assignedUserId,
    });

    beforeEach(function () {
      getMedia.resolves(bookingDocument());
      sinon.stub(BookingManager, "getBooking").resolves(bookingOf(CUSTOMER));
    });

    it("follows the receipt rule, not the library", async function () {
      expect(
        await outcome(
          MediaRights.readable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { read: null, bookingDocument: "own" }),
          ),
        ),
      ).to.equal("m1");
      expect(
        await outcome(
          MediaRights.readable(
            "m1",
            TENANT,
            bundle("staff@example.com", { read: "any", bookingDocument: null }),
          ),
        ),
      ).to.equal("404 media_not_found");
    });

    it("answers someone else's document as not there, the file as refused", async function () {
      const stranger = bundle("max@example.com", {
        bookingDocument: "own",
        updateBookingDocument: "own",
        file: "public",
      });

      expect(
        await outcome(MediaRights.readable("m1", TENANT, stranger)),
      ).to.equal("404 media_not_found");
      expect(
        await outcome(MediaRights.updatable("m1", TENANT, stranger)),
      ).to.equal("404 media_not_found");
      expect(
        await outcome(MediaRights.fileReadable("m1", TENANT, stranger)),
      ).to.equal("403 forbidden");
      expect(
        await outcome(MediaRights.fileReadable("m1", TENANT, anonymous)),
      ).to.equal("401 unauthorized");
    });

    it("covers an aggregated document for the owner of any referenced booking", async function () {
      getMedia.resolves(bookingDocument({ bookingIds: ["b0", "b1"] }));
      BookingManager.getBooking.callsFake(async (id) =>
        bookingOf(id === "b1" ? CUSTOMER : "someone-else"),
      );

      expect(
        await outcome(
          MediaRights.updatable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { updateBookingDocument: "own" }),
          ),
        ),
      ).to.equal("m1");
    });

    it("ignores the visibility of the document", async function () {
      getMedia.resolves(bookingDocument({ visibility: "public" }));

      expect(
        await outcome(MediaRights.fileReadable("m1", TENANT, anonymous)),
      ).to.equal("401 unauthorized");
    });

    it("is never deleted by hand: not there out of reach, refused within it", async function () {
      expect(
        await outcome(
          MediaRights.deletable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { delete: "own" }),
          ),
        ),
      ).to.equal("404 media_not_found");
      expect(
        await outcome(
          MediaRights.deletable(
            "m1",
            TENANT,
            bundle(CUSTOMER, { delete: "any" }),
          ),
        ),
      ).to.equal("403 booking_document_not_deletable");
    });
  });

  describe("the instance medium", function () {
    beforeEach(function () {
      getMedia.resolves(medium({ tenantId: null, uploadedBy: null }));
    });

    it("follows the instance library under the same verbs", async function () {
      expect(
        await outcome(
          MediaRights.readable("m1", null, bundle(CUSTOMER, { read: "any" })),
        ),
      ).to.equal("m1");
      expect(
        await outcome(
          MediaRights.readable("m1", null, bundle(CUSTOMER, { read: null })),
        ),
      ).to.equal("404 media_not_found");
    });

    it("serves a public file anonymously, whatever any tenant's level", async function () {
      expect(
        await outcome(MediaRights.fileReadable("m1", null, anonymous)),
      ).to.equal("m1");
      expect(getTenant.called).to.equal(false);
    });

    it("serves an internal file to any signed-in user, nobody else", async function () {
      getMedia.resolves(
        medium({ tenantId: null, uploadedBy: null, visibility: "intern" }),
      );

      expect(
        await outcome(MediaRights.fileReadable("m1", null, anonymous)),
      ).to.equal("401 unauthorized");
      expect(
        await outcome(
          MediaRights.fileReadable(
            "m1",
            null,
            bundle(CUSTOMER, { file: "any", intern: "any" }),
          ),
        ),
      ).to.equal("m1");
    });
  });

  describe("the public medium under supervision", function () {
    const serve = (reaches) =>
      outcome(MediaRights.fileReadable("m1", TENANT, reaches));

    it("serves a public medium of a tenant at a public level", async function () {
      expect(await serve(anonymous)).to.equal("m1");
    });

    it("answers 404 without a reason under a pending or declined tenant, anonymous or signed in", async function () {
      for (const supervisionLevel of ["pending", "declined"]) {
        getTenant.resolves({ id: TENANT, supervisionLevel });

        expect(await serve(anonymous), supervisionLevel).to.equal(
          "404 media_not_found",
        );
        expect(
          await serve(bundle(CUSTOMER, { file: "public", intern: null })),
          supervisionLevel,
        ).to.equal("404 media_not_found");
      }
    });

    it("keeps it readable for the tenant's own people", async function () {
      getTenant.resolves({ id: TENANT, supervisionLevel: "pending" });

      expect(await serve(bundle(UPLOADER, { file: "own" }))).to.equal("m1");
      expect(
        await serve(bundle(CUSTOMER, { file: "public", intern: "any" })),
      ).to.equal("m1");
      expect(await serve(bundle(CUSTOMER, { file: "any" }))).to.equal("m1");
    });

    it("never asks the tenant for a booking document", async function () {
      getMedia.resolves(bookingDocument());
      sinon
        .stub(BookingManager, "getBooking")
        .resolves({ id: "b1", tenantId: TENANT, assignedUserId: CUSTOMER });
      getTenant.resolves({ id: TENANT, supervisionLevel: "pending" });

      expect(
        await serve(bundle(CUSTOMER, { bookingDocument: "own" })),
      ).to.equal("m1");
      expect(getTenant.called).to.equal(false);
    });

    describe("held by offers alone", function () {
      const holder = (review, isPublic = false) => ({
        id: "b1",
        tenantId: TENANT,
        isPublic,
        review: { status: review },
      });
      const bookableSite = [{ type: "bookable", id: "b1", title: "Hall" }];

      function world({ usage, bookable }) {
        getTenant.resolves({ id: TENANT, supervisionLevel: "supervised" });
        sinon.stub(MediaUsageService, "findUsage").resolves(usage);
        sinon.stub(BookableManager, "getBookable").resolves(bookable);
      }

      it("hides a medium that only an unapproved offer holds", async function () {
        world({ usage: bookableSite, bookable: holder("pending", true) });

        expect(await serve(anonymous)).to.equal("404 media_not_found");
      });

      it("serves it with an approved offer, publication wish or not", async function () {
        world({ usage: bookableSite, bookable: holder("approved", false) });

        expect(await serve(anonymous)).to.equal("m1");
      });

      it("serves a medium that something besides offers holds, or nothing", async function () {
        world({
          usage: [...bookableSite, { type: "tenant", id: TENANT, title: "T" }],
          bookable: holder(null),
        });
        expect(await serve(anonymous)).to.equal("m1");

        MediaUsageService.findUsage.resolves([]);
        expect(await serve(anonymous)).to.equal("m1");
      });

      it("hides a medium whose offers are gone", async function () {
        world({ usage: bookableSite, bookable: null });

        expect(await serve(anonymous)).to.equal("404 media_not_found");
      });
    });

    it("looks up no holder under a tenant that is not supervised", async function () {
      const findUsage = sinon.stub(MediaUsageService, "findUsage").resolves([]);

      await serve(anonymous);

      expect(findUsage.called).to.equal(false);
    });
  });

  describe("the reference", function () {
    /** What `referenceable` answers: `ok`, or `<status> <code>`. */
    function pin(media, reaches) {
      try {
        MediaRights.referenceable(media, reaches);
        return "ok";
      } catch (err) {
        return `${err.statusCode} ${err.code}`;
      }
    }

    it("pins a tenant medium within the reach of the picker right", function () {
      expect(pin(medium(), bundle(CUSTOMER, { "media.read": "any" }))).to.equal(
        "ok",
      );
      expect(pin(medium(), bundle(UPLOADER, { "media.read": "own" }))).to.equal(
        "ok",
      );
      expect(pin(medium(), bundle(CUSTOMER, { "media.read": "own" }))).to.equal(
        "403 forbidden",
      );
      expect(pin(medium(), bundle(CUSTOMER, { "media.read": null }))).to.equal(
        "403 forbidden",
      );
    });

    it("names the medium it refuses", function () {
      try {
        MediaRights.referenceable(medium(), bundle(CUSTOMER));
        expect.fail("referenceable did not refuse");
      } catch (err) {
        expect(err.params).to.deep.equal({ mediaId: "m1" });
      }
    });

    it("asks the picker right, not the route's own entry of the same name", function () {
      // At a media route `read` is the library's; the saver of an entity
      // names the picker right of another resource, `media.read`.
      expect(pin(medium(), bundle(CUSTOMER, { read: "any" }))).to.equal(
        "403 forbidden",
      );
    });

    it("pins an instance medium for the instance library's any alone", function () {
      const instanceMedium = medium({ tenantId: null, uploadedBy: CUSTOMER });

      expect(
        pin(instanceMedium, bundle(CUSTOMER, { "instanceMedia.read": "any" })),
      ).to.equal("ok");
      expect(
        pin(instanceMedium, bundle(CUSTOMER, { "media.read": "any" })),
      ).to.equal("403 forbidden");
      expect(
        pin(instanceMedium, bundle(CUSTOMER, { "instanceMedia.read": null })),
      ).to.equal("403 forbidden");
    });

    it("loads nothing: the saver has loaded the medium in its tenant", function () {
      MediaRights.referenceable(
        medium(),
        bundle(CUSTOMER, { "media.read": "any" }),
      );

      expect(getMedia.called).to.equal(false);
    });
  });

  describe("the legacy file", function () {
    it("serves the public root to anyone", function () {
      expect(() =>
        MediaRights.legacyFileReadable(
          { isPublic: true, tenantId: TENANT },
          anonymous,
        ),
      ).not.to.throw();
    });

    it("reads a protected tenant file as an internal medium", function () {
      const read = (reaches) => () =>
        MediaRights.legacyFileReadable(
          { isPublic: false, tenantId: TENANT },
          reaches,
        );

      expect(read(anonymous)).to.throw("unauthorized");
      expect(read(bundle(CUSTOMER, { file: "public", intern: null }))).to.throw(
        "forbidden",
      );
      expect(
        read(bundle(CUSTOMER, { file: "public", intern: "any" })),
      ).not.to.throw();
      expect(read(bundle(CUSTOMER, { file: "any" }))).not.to.throw();
    });

    it("reads a protected tenant-less file for any signed-in user", function () {
      const read = (reaches) => () =>
        MediaRights.legacyFileReadable(
          { isPublic: false, tenantId: null },
          reaches,
        );

      expect(read(anonymous)).to.throw("unauthorized");
      expect(
        read(bundle(CUSTOMER, { file: "any", intern: "any" })),
      ).not.to.throw();
    });
  });
});
