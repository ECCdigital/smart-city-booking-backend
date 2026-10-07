/**
 * An edit keeps the owner of a bookable (ECCdigital/tickets#263): an API
 * client that changes a bookable without `ownerUserId` does not empty it,
 * so a member who sees only their own offers (`readOwn`) still sees it.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  OWNER,
  READ_OWN_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld } = require("./helpers/route-world");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");

/** The member's own bookable. */
const OWN_ID = "eigenes-angebot";
const ownBookable = () =>
  bookable({ id: OWN_ID, title: "Eigenes", ownerUserId: READ_OWN_HOLDER });

describe("PUT /:tenant/bookables keeps the owner", function () {
  this.timeout(30000);

  let h;
  /** Every bookable write, as the manager got it. */
  let writtenBookables;

  before(async function () {
    h = await installHarness({ bookables: { [OWN_ID]: ownBookable() } });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: OWNER,
      bookables: h.bookables,
    });
    BookableManager.storeBookable.restore();
    sinon.stub(BookableManager, "storeBookable").callsFake(async (entity) => {
      writtenBookables.push({ ...entity });
      h.bookables[entity.id] = bookable({ ...entity });
      return entity;
    });
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    writtenBookables = [];
    h.bookables[OWN_ID] = ownBookable();
  });

  const call = (method, path, userId, body) =>
    h
      .api()
      [method](path)
      .timeout({ response: 5000 })
      .set(h.as(userId))
      .send(body);

  /** The stored bookable as a client sends it back, without its owner. */
  const withoutOwner = (changes) => {
    const body = {
      ...JSON.parse(JSON.stringify(h.bookables[OWN_ID])),
      ...changes,
    };
    delete body.ownerUserId;
    return body;
  };

  const EDITORS = {
    "tenant owner": OWNER,
    "member with updateOwn": READ_OWN_HOLDER,
  };

  for (const [who, userId] of Object.entries(EDITORS)) {
    it(`keeps the owner when the ${who} leaves ownerUserId out`, async function () {
      const res = await call(
        "put",
        `/api/${TENANT}/bookables`,
        userId,
        withoutOwner({ title: "Geändert" }),
      );

      expect(res.status).to.equal(201);
      expect(res.body.ownerUserId).to.equal(READ_OWN_HOLDER);
      expect(writtenBookables).to.have.length(1);
      expect(writtenBookables[0]).to.include({
        id: OWN_ID,
        title: "Geändert",
        ownerUserId: READ_OWN_HOLDER,
      });

      const list = await call(
        "get",
        `/api/${TENANT}/bookables`,
        READ_OWN_HOLDER,
      );
      expect(list.status).to.equal(200);
      expect(list.body.map((offer) => offer.id)).to.include(OWN_ID);

      const one = await call(
        "get",
        `/api/${TENANT}/bookables/${OWN_ID}`,
        READ_OWN_HOLDER,
      );
      expect(one.status).to.equal(200);
      expect(one.body.title).to.equal("Geändert");
    });
  }

  it("stores the owner a body names, as before", async function () {
    const res = await call("put", `/api/${TENANT}/bookables`, OWNER, {
      ...withoutOwner({ title: "Übergeben" }),
      ownerUserId: OWNER,
    });

    expect(res.status).to.equal(201);
    expect(writtenBookables).to.have.length(1);
    expect(writtenBookables[0]).to.include({
      id: OWN_ID,
      ownerUserId: OWNER,
    });
  });
});
