/**
 * `PUT /api/instances` stores its body as the whole instance, so a body
 * without owners left the instance without any instance owner
 * (ECCdigital/tickets#105): a body that lacks `ownerUserIds` or names none
 * is refused with `400` and the instance stays as it is; a complete body is
 * stored as before. The real manager runs behind the route, over a model
 * that keeps the stored instance of the harness, which `GET` answers.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  ROLE_HOLDER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const Instance = require("../src/commons/entities/instance/instance");

const clone = (value) => JSON.parse(JSON.stringify(value));

describe("PUT /api/instances without owners", function () {
  this.timeout(20000);

  let h;
  let kept;

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
      },
      instance: {
        isInitialized: true,
        portalUrl: "https://portal.example",
      },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });

    // The model keeps the harness' stored instance: a write replaces it as
    // the database would, and every read of the instance sees the result.
    const stored = () => ({
      ...clone(h.instance),
      toEntity: () => new Instance(clone(h.instance)),
    });
    InstanceManager.updateInstance.restore();
    InstanceModel.findOne.callsFake(async () => stored());
    sinon
      .stub(InstanceModel, "findOneAndUpdate")
      .callsFake(async (filter, { $set }) => {
        replaceStored(clone($set));
        return stored();
      });
    sinon.stub(InstanceModel.collection, "updateOne").resolves();
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  function replaceStored(record) {
    for (const key of Object.keys(h.instance)) delete h.instance[key];
    Object.assign(h.instance, record);
  }

  beforeEach(function () {
    kept = clone(h.instance);
  });

  afterEach(function () {
    replaceStored(kept);
  });

  const put = (body) =>
    h.api().put("/api/instances").set(h.as(ADMIN)).send(body);

  /** What `GET /api/instances` answers the instance owner afterwards. */
  async function expectStored(fields) {
    const res = await h.api().get("/api/instances").set(h.as(ADMIN));
    expect(res.status).to.equal(200);
    expect(res.body).to.include(fields);
    expect(res.body.ownerUserIds).to.deep.equal([ADMIN]);
  }

  for (const [name, body] of [
    ["an empty body", {}],
    ["a body without ownerUserIds", { contactUrl: "https://a.example" }],
    ["an empty owner list", { ownerUserIds: [], isInitialized: true }],
    ["an owner list of one empty id", { ownerUserIds: [""] }],
    ["an owner list of blank ids", { ownerUserIds: ["  ", "", "\t"] }],
  ]) {
    it(`refuses ${name} with 400 and keeps the instance`, async function () {
      const res = await put(body);

      expect(res.status).to.equal(400);
      expect(res.body).to.include({
        code: "instance_owners_required",
        statusCode: 400,
      });
      expect(res.body.params).to.deep.equal({ field: "ownerUserIds" });

      await expectStored({
        isInitialized: true,
        portalUrl: "https://portal.example",
      });
    });
  }

  it("stores a complete body as before", async function () {
    const res = await put({
      ownerUserIds: [ADMIN],
      isInitialized: true,
      portalUrl: "https://portal.example",
      contactUrl: "https://a.example",
    });

    expect(res.status).to.equal(200);
    await expectStored({
      isInitialized: true,
      portalUrl: "https://portal.example",
      contactUrl: "https://a.example",
    });
  });
});
