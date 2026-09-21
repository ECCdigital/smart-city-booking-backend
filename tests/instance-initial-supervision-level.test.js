/**
 * The initial supervision level of the instance (glossary "Startstufe",
 * tenant supervision spec §2, §3): `free`, `supervised` or `blocked`,
 * `free` where nothing is stored; written by the instance owner alone and
 * validated; part of the public instance without any private data; and
 * never retroactive - a change touches no existing tenant.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ADMIN,
  OWNER,
  ROLE_HOLDER,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./helpers/route-world");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");
const TenantModel = require("../src/commons/data-managers/models/tenantModel");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const Instance = require("../src/commons/entities/instance/instance");

const FIELD = "tenantInitialSupervisionLevel";

describe("the initial supervision level of the instance", function () {
  describe("on the way in", function () {
    let update;
    let stored;
    let tenantWrites;

    beforeEach(function () {
      update = null;
      stored = { bookableCustomFields: [] };

      const raw = () => ({ ...stored, toEntity: () => ({ ...stored }) });
      sinon.stub(InstanceModel, "findOne").callsFake(async () => raw());
      sinon
        .stub(InstanceModel, "findOneAndUpdate")
        .callsFake(async (filter, written) => {
          update = written;
          return raw();
        });
      sinon.stub(InstanceModel.collection, "updateOne").resolves();
      tenantWrites = ["updateOne", "updateMany", "findOneAndUpdate"].map(
        (name) => sinon.stub(TenantModel, name).resolves(null),
      );
    });

    afterEach(function () {
      sinon.restore();
    });

    async function refused(body) {
      try {
        await InstanceManager.updateInstance(body);
      } catch (error) {
        return error;
      }
      throw new Error("expected the instance write to be refused");
    }

    for (const level of ["free", "supervised", "blocked"]) {
      it(`stores ${level}`, async function () {
        await InstanceManager.updateInstance({ [FIELD]: level });

        expect(update.$set[FIELD]).to.equal(level);
      });
    }

    for (const value of ["strict", "", null, 1, ["free"]]) {
      it(`refuses ${JSON.stringify(value)} as invalid_supervision_level and writes nothing`, async function () {
        const error = await refused({ [FIELD]: value });

        expect(error.statusCode).to.equal(400);
        expect(error.toJSON().code).to.equal("invalid_supervision_level");
        expect(update).to.equal(null);
      });
    }

    it("keeps the stored level when the write does not name one", async function () {
      stored[FIELD] = "supervised";

      await InstanceManager.updateInstance({ contactUrl: "https://a.example" });

      expect(update.$set[FIELD]).to.equal("supervised");
    });

    it("stores free when neither the write nor the instance names one", async function () {
      await InstanceManager.updateInstance({ contactUrl: "https://a.example" });

      expect(update.$set[FIELD]).to.equal("free");
    });

    it("touches no existing tenant", async function () {
      await InstanceManager.updateInstance({ [FIELD]: "blocked" });

      for (const write of tenantWrites) {
        expect(write.called).to.be.false;
      }
    });
  });

  describe("on the way out", function () {
    it("defaults to free for a new instance and one stored before the field existed", function () {
      expect(new Instance()[FIELD]).to.equal("free");
      expect(new Instance({ contactUrl: "https://a.example" })[FIELD]).to.equal(
        "free",
      );
    });

    it("is part of the public export, the private data is not", function () {
      const instance = new Instance({
        [FIELD]: "supervised",
        ownerUserIds: ["owner"],
        allowedUsersToCreateTenant: ["someone"],
        allowAllUsersToCreateTenant: true,
        noreplyPassword: { encrypted: "x" },
      });

      instance.removePrivateData();
      const exported = instance.exportWithMedia();

      expect(exported[FIELD]).to.equal("supervised");
      for (const field of [
        "ownerUserIds",
        "allowedUsersToCreateTenant",
        "allowAllUsersToCreateTenant",
        "noreplyPassword",
        "mailTemplate",
      ]) {
        expect(exported).to.not.have.property(field);
      }
    });
  });

  describe("over the routes", function () {
    this.timeout(20000);

    let h;
    let instance;

    before(async function () {
      h = await installHarness({
        bookables: {
          [FIXTURE_ID]: bookable({
            id: FIXTURE_ID,
            title: "Fixture",
            ownerUserId: ROLE_HOLDER,
          }),
        },
      });
      installRouteWorld({
        tenantId: TENANT,
        tenant: h.tenant,
        ownerUserId: ROLE_HOLDER,
        bookables: h.bookables,
      });
    });

    after(async function () {
      sinon.restore();
      await h.close();
    });

    beforeEach(function () {
      instance = new Instance({
        id: "instance",
        ownerUserIds: [ADMIN],
        allowedUsersToCreateTenant: [CUSTOMER],
        [FIELD]: "supervised",
      });
      InstanceManager.getInstance.restore();
      sinon
        .stub(InstanceManager, "getInstance")
        .callsFake(async () => new Instance({ ...instance }));
      InstanceManager.updateInstance.resetHistory();
      TenantManager.updateSupervisionLevel.resetHistory();
    });

    const call = (method, path, userId, body) => {
      let req = h.api()[method](`/api${path}`);
      if (userId) req = req.set(h.as(userId));
      if (body) req = req.send(body);
      return req;
    };

    it("answers it publicly, without the private instance data", async function () {
      const res = await call("get", "/instances/public");

      expect(res.status).to.equal(200);
      expect(res.body[FIELD]).to.equal("supervised");
      expect(res.body).to.not.have.property("ownerUserIds");
      expect(res.body).to.not.have.property("allowedUsersToCreateTenant");
      expect(res.body).to.not.have.property("allowAllUsersToCreateTenant");
    });

    it("answers it to the instance owner", async function () {
      const res = await call("get", "/instances", ADMIN);

      expect(res.status).to.equal(200);
      expect(res.body[FIELD]).to.equal("supervised");
    });

    it("lets the instance owner alone write it", async function () {
      for (const userId of [OWNER, ROLE_HOLDER, CUSTOMER]) {
        const res = await call("put", "/instances", userId, {
          [FIELD]: "free",
        });
        expect(res.status, userId).to.equal(403);
      }
      expect(
        (await call("put", "/instances", null, { [FIELD]: "free" })).status,
      ).to.equal(401);
      expect(InstanceManager.updateInstance.called).to.be.false;
    });

    it("answers an unknown level with 400 invalid_supervision_level", async function () {
      InstanceManager.updateInstance.restore();
      const write = sinon.stub(InstanceModel, "findOneAndUpdate");
      try {
        const res = await call("put", "/instances", ADMIN, {
          [FIELD]: "strict",
        });

        expect(res.status).to.equal(400);
        expect(res.body.code).to.equal("invalid_supervision_level");
        expect(write.called).to.be.false;
      } finally {
        write.restore();
        sinon.stub(InstanceManager, "updateInstance").resolves(null);
      }
    });

    it("changes no tenant when the instance owner changes it", async function () {
      const res = await call("put", "/instances", ADMIN, {
        [FIELD]: "blocked",
      });

      expect(res.status).to.equal(200);
      expect(InstanceManager.updateInstance.firstCall.args[0][FIELD]).to.equal(
        "blocked",
      );
      expect(TenantManager.updateSupervisionLevel.called).to.be.false;
    });
  });
});
