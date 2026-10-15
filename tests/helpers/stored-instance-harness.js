const sinon = require("sinon");

const {
  installHarness,
  bookable,
  TENANT,
  ROLE_HOLDER,
} = require("./booking-lifecycle-harness");
const { installRouteWorld, FIXTURE_ID } = require("./route-world");
const InstanceManager = require("../../src/commons/data-managers/instance-manager");
const InstanceModel = require("../../src/commons/data-managers/models/instanceModel");
const Instance = require("../../src/commons/entities/instance/instance");
const {
  InstanceCache,
} = require("../../src/commons/services/instance/instance-cache");
const {
  ThemeExportCache,
} = require("../../src/commons/services/catalog/theme-export-cache");

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * The harness of the branding suites (map #510): the lifecycle harness and
 * the route world, with the real `PUT /api/instances` and the real branding
 * read behind the routes. The model keeps the harness' stored instance: a
 * write replaces it as the database would, and every read of the instance
 * sees the result — the branding read of the Theme Bundle included, lean as
 * stored. Every test starts from the instance the suite started with, with
 * empty caches.
 *
 * Call it in a `describe` body: it registers the hooks of the suite.
 *
 * @param {function(Object): (void|Promise<void>)} setup - Runs at the end of
 *   `before` with the harness, for what the suite stubs on top.
 */
function installStoredInstanceHarness(setup) {
  let h;
  let kept;

  function replaceStored(record) {
    for (const key of Object.keys(h.instance)) delete h.instance[key];
    Object.assign(h.instance, record);
  }

  before(async function () {
    h = await installHarness({
      bookables: {
        [FIXTURE_ID]: bookable({
          id: FIXTURE_ID,
          title: "Fixture",
          ownerUserId: ROLE_HOLDER,
        }),
      },
      instance: { isInitialized: true },
    });
    installRouteWorld({
      tenantId: TENANT,
      tenant: h.tenant,
      ownerUserId: ROLE_HOLDER,
      bookables: h.bookables,
    });

    const stored = () => ({
      ...clone(h.instance),
      toEntity: () => new Instance(clone(h.instance)),
    });
    InstanceManager.updateInstance.restore();
    InstanceManager.getBranding.restore();
    InstanceModel.findOne.callsFake(async () => stored());
    InstanceModel.findOne
      .withArgs({}, sinon.match.has("branding"))
      .returns({ lean: async () => clone(h.instance) });
    sinon
      .stub(InstanceModel, "findOneAndUpdate")
      .callsFake(async (filter, { $set }) => {
        replaceStored(clone($set));
        return stored();
      });
    sinon.stub(InstanceModel.collection, "updateOne").resolves();

    await setup(h);
  });

  after(async function () {
    sinon.restore();
    await h.close();
  });

  beforeEach(function () {
    kept = clone(h.instance);
    InstanceCache.invalidate();
    ThemeExportCache.invalidateAll();
  });

  afterEach(function () {
    replaceStored(kept);
    InstanceCache.invalidate();
    ThemeExportCache.invalidateAll();
  });
}

module.exports = { installStoredInstanceHarness };
