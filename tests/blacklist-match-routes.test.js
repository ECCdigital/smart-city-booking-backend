/**
 * The administration's ways warn of an address on the blacklist (glossary
 * „Blacklist“): the manual booking, changing the
 * mail of a booking, creating a user, inviting into a tenant and changing
 * a user id ask before they save. The answer tells only whether an entry
 * hits the address - never the entry or its reason - and is open to every
 * role that may go the way. Saving anyway is no refusal and suspends no
 * account.
 *
 * Runs over the real routers on the lifecycle harness, the user collection
 * in memory below `UserManager` and the blacklist in memory below
 * `BlacklistManager`.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  ADMIN,
  OWNER,
  CUSTOMER,
  TENANT,
} = require("./helpers/booking-lifecycle-harness");
const mongoose = require("mongoose");
const UserManager = require("../src/commons/data-managers/user-manager");
const BookingManager = require("../src/commons/data-managers/booking-manager");
const GroupBookingManager = require("../src/commons/data-managers/group-booking-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const CouponManager = require("../src/commons/data-managers/coupon-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const FavoriteManager = require("../src/commons/data-managers/favorite-manager");
const TokenSessionService = require("../src/commons/services/token-session-service");
const {
  account,
  installUserCollection,
} = require("./helpers/auth-user-collection");

const BLOCKED = "max@firma.test";
const CLEAN = "anna@sauber.test";

const entry = (value, kind = "address") => ({
  id: `entry-${value}`,
  value,
  kind,
  reason: "Beleidigt Personal",
  createdAt: 1,
  createdBy: ADMIN,
  origin: "manual",
  suspendedUserIds: [],
});

describe("blacklist warnings of the administration", function () {
  this.timeout(20000);

  let h;
  let users;

  beforeEach(async function () {
    h = await installHarness();
    UserManager.getUser.restore();
    UserManager.getRawUser.restore();
    users = installUserCollection([
      account(ADMIN, "geheim-1234"),
      account(OWNER, "geheim-1234"),
      account(CUSTOMER, "geheim-1234"),
    ]);
    h.blacklist.push(entry(BLOCKED), entry("@wegwerf.test", "domain"));
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const stored = (id) => users.find((doc) => doc.id === id);
  const match = (path, address, by = ADMIN) =>
    h.api().post(path).set(h.as(by)).send({ address });

  /** The route each way asks; creating a user and changing an id share one. */
  const WAYS = [
    ["the manual booking", `/api/${TENANT}/bookings/blacklist-match`],
    ["the mail of a booking", `/api/${TENANT}/bookings/blacklist-match/mail`],
    ["the invitation", `/api/tenants/${TENANT}/users/blacklist-match`],
    ["the user (create, change id)", "/api/users/blacklist-match"],
  ];

  for (const [way, path] of WAYS) {
    describe(way, function () {
      it("tells a hit and nothing of the entry", async function () {
        const res = await match(path, " Max@Firma.test ");

        expect(res.status).to.equal(200);
        expect(res.body).to.deep.equal({ blacklisted: true });
      });

      it("tells a hit of a domain entry", async function () {
        const res = await match(path, "wer@wegwerf.test");

        expect(res.body).to.deep.equal({ blacklisted: true });
      });

      it("tells no hit for a clean address, a subdomain and a plus address", async function () {
        for (const address of [
          CLEAN,
          "wer@sub.wegwerf.test",
          "max+news@firma.test",
          "",
        ]) {
          const res = await match(path, address);

          expect(res.status).to.equal(200);
          expect(res.body, address).to.deep.equal({ blacklisted: false });
        }
      });

      it("asks each address of a list for itself", async function () {
        const res = await match(path, `${CLEAN}, ${BLOCKED}`);

        expect(res.body).to.deep.equal({ blacklisted: true });
      });
    });
  }

  describe("saving anyway", function () {
    it("creates the user unsuspended", async function () {
      const res = await h
        .api()
        .put("/api/users")
        .set(h.as(ADMIN))
        .send({ id: BLOCKED, firstName: "Max" });

      expect(res.status).to.equal(200);
      expect(stored(BLOCKED).isSuspended).to.equal(false);
    });

    it("changes the user id unsuspended", async function () {
      // The references to the user in the other collections are no matter
      // here, and no replica set runs: no transaction.
      sinon.stub(mongoose, "startSession").resolves({
        withTransaction: async (callback) => callback(),
        endSession: async () => {},
      });
      for (const [store, method] of [
        [BookingManager, "reassignUserReferences"],
        [GroupBookingManager, "reassignUserReferences"],
        [BookableManager, "reassignOwnerUserId"],
        [EventManager, "reassignOwnerUserId"],
        [CouponManager, "reassignOwnerUserId"],
        [MembershipManager, "reassignUserId"],
        [TokenSessionService, "reassignUserId"],
        [InstanceManager, "reassignOwnerUserId"],
        [FavoriteManager, "reassignUserId"],
      ]) {
        sinon.stub(store, method).resolves();
      }

      const res = await h
        .api()
        .post(`/api/users/${CUSTOMER}/change-id`)
        .set(h.as(ADMIN))
        .send({ newId: BLOCKED });

      expect(res.status).to.equal(200);
      expect(stored(BLOCKED).isSuspended).to.equal(false);
    });

    it("stores the manual booking", async function () {
      const booking = await h.manualBooking("auto-room", {}, { mail: BLOCKED });

      expect(h.stored(booking.id).mail).to.equal(BLOCKED);
    });
  });
});
