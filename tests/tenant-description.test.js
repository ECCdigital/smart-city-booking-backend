const assert = require("assert");
const sinon = require("sinon");
const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const TenantCreationService = require("../src/commons/services/tenant/tenant-creation-service");
const Tenant = require("../src/commons/entities/tenant/tenant");

function response(sandbox) {
  return {
    status: sandbox.stub().returnsThis(),
    send: sandbox.stub().returnsThis(),
    sendStatus: sandbox.stub().returnsThis(),
  };
}

describe("the short description of a tenant", function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("is empty by default", function () {
    assert.strictEqual(new Tenant({ id: "t", name: "Verein" }).description, "");
  });

  describe("on update", function () {
    function update(body) {
      const tenant = new Tenant({ id: "tenant-1", name: "Tenant" });
      sandbox.stub(TenantManager, "getTenant").resolves(tenant);
      const storeTenant = sandbox
        .stub(TenantManager, "storeTenant")
        .callsFake(async (value) => value);
      const res = response(sandbox);
      return TenantController.updateTenant(
        { user: { id: "admin-1" }, body: { id: "tenant-1", ...body } },
        res,
      ).then(() => ({ tenant, storeTenant, res }));
    }

    it("stores up to 300 characters", async function () {
      const description = "a".repeat(300);

      const { tenant, storeTenant, res } = await update({ description });

      assert.strictEqual(storeTenant.calledOnce, true);
      assert.strictEqual(res.status.calledWith(200), true);
      assert.strictEqual(tenant.description, description);
    });

    it("stores an emptied description", async function () {
      const { tenant, storeTenant, res } = await update({ description: "" });

      assert.strictEqual(storeTenant.calledOnce, true);
      assert.strictEqual(res.status.calledWith(200), true);
      assert.strictEqual(tenant.description, "");
    });

    it("refuses 301 characters with 400", async function () {
      const { storeTenant, res } = await update({
        description: "a".repeat(301),
      });

      assert.strictEqual(res.status.calledWith(400), true);
      assert.strictEqual(storeTenant.called, false);
    });

    it("refuses anything but text with 400", async function () {
      const { storeTenant, res } = await update({ description: { de: "x" } });

      assert.strictEqual(res.status.calledWith(400), true);
      assert.strictEqual(storeTenant.called, false);
    });
  });

  describe("on creation", function () {
    it("refuses 301 characters with 400 before creating", async function () {
      const create = sandbox.stub(TenantCreationService, "create");
      const res = response(sandbox);

      await TenantController.createTenant(
        {
          user: { id: "admin-1" },
          body: {
            name: "Verein",
            contactName: "Alex",
            mail: "alex@example.org",
            description: "a".repeat(301),
          },
        },
        res,
      );

      assert.strictEqual(res.status.calledWith(400), true);
      assert.strictEqual(create.called, false);
    });
  });
});
