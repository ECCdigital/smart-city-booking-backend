/**
 * The blacklist of the instance (glossary „Blacklist“, „Blacklist-Eintrag“,
 * ECCdigital/tickets#625): the instance owner keeps exact addresses and
 * whole domains with a reason. A new entry suspends the matching accounts
 * at once - not instance owners, not accounts already suspended - with the
 * origin `blacklist`; removing it lifts only the suspensions it made.
 *
 * Runs over the real routers on the lifecycle harness, the user collection
 * in memory below `UserManager` at the model and the blacklist in memory
 * below `BlacklistManager`.
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
const UserManager = require("../src/commons/data-managers/user-manager");
const BlacklistService = require("../src/commons/services/blacklist/blacklist-service");
const {
  account,
  installUserCollection,
} = require("./helpers/auth-user-collection");
const {
  installBlacklistCollection,
} = require("./helpers/blacklist-collection");

const MAX = "max@firma.test";
const MAX_PLUS = "max+news@firma.test";
const ANNA = "anna@firma.test";
const SUB = "eva@sub.firma.test";

describe("blacklist (ECCdigital/tickets#625)", function () {
  this.timeout(20000);

  let h;
  let users;
  let entries;

  beforeEach(async function () {
    h = await installHarness();
    UserManager.getUser.restore();
    UserManager.getRawUser.restore();
    users = installUserCollection([
      account(ADMIN, "geheim-1234"),
      account(OWNER, "geheim-1234"),
      account(CUSTOMER, "geheim-1234"),
      account(MAX, "geheim-1234"),
      account(MAX_PLUS, "geheim-1234"),
      account(ANNA, "geheim-1234"),
      account(SUB, "geheim-1234"),
    ]);
    entries = installBlacklistCollection();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const user = (id) => users.find((doc) => doc.id === id);
  const create = (body, by = ADMIN) =>
    h.api().post("/api/instances/blacklist").set(h.as(by)).send(body);

  describe("adding an entry", function () {
    it("suspends the account of an exact address with the entry's reason, time and person", async function () {
      const before = Date.now();

      const res = await create({ value: MAX, reason: "Beleidigt Personal" });

      expect(res.status).to.equal(201);
      expect(res.body).to.include({
        value: MAX,
        kind: "address",
        reason: "Beleidigt Personal",
        createdBy: ADMIN,
        origin: "manual",
      });
      expect(res.body.createdAt).to.be.within(before, Date.now());
      expect(res.body.suspendedUserIds).to.deep.equal([MAX]);
      expect(user(MAX).isSuspended).to.equal(true);
      expect(user(MAX).suspension).to.deep.include({
        reason: "Beleidigt Personal",
        suspendedBy: ADMIN,
        origin: "blacklist",
        blacklistEntry: { id: res.body.id, value: MAX },
      });
      expect(user(MAX).suspension.suspendedAt).to.be.within(before, Date.now());
      expect(user(MAX_PLUS).isSuspended ?? false).to.equal(false);
      expect(user(ANNA).isSuspended ?? false).to.equal(false);
    });

    it("stores the value trimmed and in lower case, as the user ids", async function () {
      const res = await create({ value: "  Max@FIRMA.test ", reason: "Test" });

      expect(res.status).to.equal(201);
      expect(res.body.value).to.equal(MAX);
      expect(user(MAX).isSuspended).to.equal(true);
    });

    it("takes a plus address as an address of its own", async function () {
      const res = await create({ value: MAX_PLUS, reason: "Test" });

      expect(res.body.suspendedUserIds).to.deep.equal([MAX_PLUS]);
      expect(user(MAX).isSuspended ?? false).to.equal(false);
    });

    it("suspends every account of a domain, but none of its subdomains", async function () {
      const res = await create({ value: "@Firma.test", reason: "Wegwerf" });

      expect(res.status).to.equal(201);
      expect(res.body).to.include({ value: "@firma.test", kind: "domain" });
      expect(res.body.suspendedUserIds).to.have.members([MAX, MAX_PLUS, ANNA]);
      expect(user(ANNA).suspension.blacklistEntry.value).to.equal(
        "@firma.test",
      );
      expect(user(SUB).isSuspended ?? false).to.equal(false);
    });

    it("leaves out instance owners and accounts already suspended", async function () {
      user(CUSTOMER).isSuspended = true;
      user(CUSTOMER).suspension = { reason: "von Hand", origin: "manual" };

      const res = await create({ value: "@example.test", reason: "Test" });

      expect(res.body.suspendedUserIds).to.deep.equal([OWNER]);
      expect(user(ADMIN).isSuspended ?? false).to.equal(false);
      expect(user(CUSTOMER).suspension.origin).to.equal("manual");
    });

    for (const [name, body, code] of [
      ["no reason", { value: MAX }, "blacklist_reason_required"],
      [
        "a blank reason",
        { value: MAX, reason: "  " },
        "blacklist_reason_required",
      ],
      ["no value", { reason: "Test" }, "blacklist_value_invalid"],
      [
        "a value that is no address",
        { value: "max", reason: "Test" },
        "blacklist_value_invalid",
      ],
      [
        "a domain without @",
        { value: "firma.test", reason: "Test" },
        "blacklist_value_invalid",
      ],
    ]) {
      it(`refuses ${name} with 400 and suspends nobody`, async function () {
        const res = await create(body);

        expect(res.status).to.equal(400);
        expect(res.body.code).to.equal(code);
        expect(entries).to.have.lengthOf(0);
        expect(user(MAX).isSuspended ?? false).to.equal(false);
      });
    }

    it("refuses a second entry of the same value with 409", async function () {
      await create({ value: MAX, reason: "Test" });

      const res = await create({ value: " MAX@firma.test", reason: "nochmal" });

      expect(res.status).to.equal(409);
      expect(res.body.code).to.equal("blacklist_entry_exists");
      expect(entries).to.have.lengthOf(1);
    });

    it("is the instance owner's alone", async function () {
      const res = await create({ value: MAX, reason: "Test" }, OWNER);

      expect(res.status).to.equal(403);
      expect(entries).to.have.lengthOf(0);
    });
  });

  describe("the preview", function () {
    const preview = (value, by = ADMIN) =>
      h
        .api()
        .get("/api/instances/blacklist/preview")
        .query({ value })
        .set(h.as(by));

    it("names the accounts to suspend, the instance owners and the accounts already suspended apart", async function () {
      user(CUSTOMER).isSuspended = true;

      const res = await preview(" @EXAMPLE.test");

      expect(res.status).to.equal(200);
      expect(res.body).to.deep.include({
        value: "@example.test",
        kind: "domain",
        exists: false,
      });
      const ids = (group) => res.body.accounts[group].map((a) => a.id);
      expect(ids("suspend")).to.deep.equal([OWNER]);
      expect(ids("instanceOwners")).to.deep.equal([ADMIN]);
      expect(ids("alreadySuspended")).to.deep.equal([CUSTOMER]);
      expect(entries).to.have.lengthOf(0);
      expect(user(OWNER).isSuspended ?? false).to.equal(false);
    });

    it("names the tenants each account is an active member of", async function () {
      const res = await preview(MAX);

      expect(res.body.accounts.suspend).to.deep.equal([
        {
          id: MAX,
          firstName: "Konto",
          lastName: "max",
          tenants: [{ id: TENANT, name: "Stadt Musterhausen" }],
        },
      ]);
    });

    it("tells an entry of the value exists", async function () {
      await create({ value: MAX, reason: "Test" });

      const res = await preview(MAX);

      expect(res.body.exists).to.equal(true);
      expect(res.body.accounts.alreadySuspended.map((a) => a.id)).to.deep.equal(
        [MAX],
      );
    });

    it("refuses a value that is no address or domain and is the instance owner's alone", async function () {
      expect((await preview("max")).status).to.equal(400);
      expect((await preview(MAX, OWNER)).status).to.equal(403);
    });
  });

  describe("the list", function () {
    it("shows every entry, newest first", async function () {
      const clock = sinon.useFakeTimers({ now: 1000, toFake: ["Date"] });
      await create({ value: MAX, reason: "erster" });
      clock.tick(1000);
      await create({ value: "@wegwerf.test", reason: "zweiter" });
      clock.restore();

      const res = await h
        .api()
        .get("/api/instances/blacklist")
        .set(h.as(ADMIN));

      expect(res.status).to.equal(200);
      expect(res.body.map((entry) => entry.value)).to.deep.equal([
        "@wegwerf.test",
        MAX,
      ]);
      const owner = await h
        .api()
        .get("/api/instances/blacklist")
        .set(h.as(OWNER));
      expect(owner.status).to.equal(403);
    });
  });

  describe("changing the reason", function () {
    const change = (id, body, by = ADMIN) =>
      h.api().put(`/api/instances/blacklist/${id}`).set(h.as(by)).send(body);

    it("changes the reason alone, value and kind stay", async function () {
      const { body: entry } = await create({ value: MAX, reason: "alt" });

      const res = await change(entry.id, {
        reason: " neu ",
        value: "@firma.test",
        kind: "domain",
      });

      expect(res.status).to.equal(200);
      expect(res.body).to.include({
        reason: "neu",
        value: MAX,
        kind: "address",
      });
    });

    it("refuses a blank reason, an unknown entry and anyone but the instance owner", async function () {
      const { body: entry } = await create({ value: MAX, reason: "alt" });

      expect((await change(entry.id, { reason: " " })).status).to.equal(400);
      expect((await change("unbekannt", { reason: "neu" })).status).to.equal(
        404,
      );
      expect(
        (await change(entry.id, { reason: "neu" }, OWNER)).status,
      ).to.equal(403);
      expect(entries[0].reason).to.equal("alt");
    });
  });

  describe("removing an entry", function () {
    const remove = (id, query = {}, by = ADMIN) =>
      h
        .api()
        .delete(`/api/instances/blacklist/${id}`)
        .query(query)
        .set(h.as(by));

    it("with unsuspend lifts only the suspensions this entry made", async function () {
      const { body: entry } = await create({
        value: "@firma.test",
        reason: "Test",
      });
      // Since then: ANNA suspended by hand, MAX_PLUS by another entry.
      await h
        .api()
        .post(`/api/users/${ANNA}/suspension`)
        .set(h.as(ADMIN))
        .send({ reason: "von Hand" });
      user(MAX_PLUS).suspension.blacklistEntry = {
        id: "andere",
        value: MAX_PLUS,
      };
      user(OWNER).isSuspended = true;

      const res = await remove(entry.id, { unsuspend: "true" });

      expect(res.status).to.equal(200);
      expect(res.body.unsuspendedUserIds).to.deep.equal([MAX]);
      expect(entries).to.have.lengthOf(0);
      expect(user(MAX).isSuspended).to.equal(false);
      expect(user(MAX).suspension).to.equal(null);
      expect(user(ANNA).suspension.origin).to.equal("manual");
      expect(user(MAX_PLUS).isSuspended).to.equal(true);
      expect(user(OWNER).isSuspended).to.equal(true);
    });

    it("without unsuspend leaves the suspensions it made", async function () {
      const { body: entry } = await create({ value: MAX, reason: "Test" });

      const res = await remove(entry.id);

      expect(res.status).to.equal(200);
      expect(res.body.unsuspendedUserIds).to.deep.equal([]);
      expect(entries).to.have.lengthOf(0);
      expect(user(MAX).isSuspended).to.equal(true);
    });

    it("answers 404 for an unknown entry and is the instance owner's alone", async function () {
      const { body: entry } = await create({ value: MAX, reason: "Test" });

      expect((await remove("unbekannt")).status).to.equal(404);
      expect(
        (await remove(entry.id, { unsuspend: "true" }, OWNER)).status,
      ).to.equal(403);
      expect(entries).to.have.lengthOf(1);
      expect(user(MAX).isSuspended).to.equal(true);
    });
  });

  describe("the question of the module: which entry hits an address", function () {
    beforeEach(async function () {
      await create({ value: MAX, reason: "exakt" });
      await create({ value: "@firma.test", reason: "Domain" });
    });

    const hit = async (address) =>
      (await BlacklistService.match(address))?.value ?? null;

    it("answers the exact entry before the domain", async function () {
      expect(await hit(" MAX@Firma.TEST ")).to.equal(MAX);
    });

    it("answers the domain for another address of it, a plus address included", async function () {
      expect(await hit(ANNA)).to.equal("@firma.test");
      expect(await hit(MAX_PLUS)).to.equal("@firma.test");
    });

    it("answers nothing for a subdomain, another domain or no address", async function () {
      expect(await hit(SUB)).to.equal(null);
      expect(await hit("max@firma.test.example")).to.equal(null);
      expect(await hit("firma.test")).to.equal(null);
      expect(await hit(undefined)).to.equal(null);
    });
  });
});
