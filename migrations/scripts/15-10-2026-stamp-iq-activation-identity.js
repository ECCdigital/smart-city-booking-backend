/**
 * Stamps every Salto KS IQ activation with the identity it was earned under
 * (ECCdigital/tickets#573): the site as its UUID in lower case, the system user
 * (`username`) and the environment. From 4.4.0 on an activation counts only
 * under that identity, so without the stamp the activations stored before
 * would rest, and the IQs would need an activation Salto no longer gives
 * (the first secret comes once per system user and IQ).
 *
 * The identity is the one the tenant's Salto application names today. A
 * site named by `site_uid` or `customer_reference` is resolved through the
 * list of sites at Salto, as the client does; when Salto cannot be reached
 * the migration stops before it writes anything, naming tenant and site,
 * and the instance stays out of traffic. A site named by its UUID needs no
 * call.
 *
 * Only an entry without `siteId` is stamped, so the migration can run
 * again; an entry already stamped keeps its identity, also one that rests.
 * It writes through the collection, past the tenant model's middleware.
 */

const clientRegistry = require("../../src/commons/services/access/clients/access-client-registry");
const SaltoKsIqActivationService = require("../../src/commons/services/access/salto-ks-iq-activation-service");

require("../../src/commons/services/access/clients");

const NAME = "15-10-2026-stamp-iq-activation-identity";
const SALTO_APP = Object.freeze({ type: "access", id: "salto-ks" });

const isUnstamped = (entry) => entry && entry.siteId === undefined;

/**
 * The identity of the tenant's Salto application.
 *
 * @throws {Error} Naming tenant and site when the site cannot be resolved
 */
async function identityOf(tenant, app) {
  try {
    return await SaltoKsIqActivationService.identityOf(
      clientRegistry.createClient(app),
    );
  } catch (err) {
    throw new Error(
      `${NAME}: the Salto KS site '${app.siteId}' of tenant '${tenant.id}' could not be resolved (${err.message}). Salto KS must be reachable for this migration; the upgrade can be run again once it is.`,
    );
  }
}

async function stampIqActivations(mongoose) {
  const Tenant = mongoose.model("Tenant");
  const tenants = await Tenant.find({
    applications: {
      $elemMatch: { ...SALTO_APP, "iqActivations.0": { $exists: true } },
    },
  }).lean();

  // Every identity first, so a site Salto cannot resolve stops the
  // migration before anything is written.
  const stamps = [];
  for (const tenant of tenants) {
    const app = tenant.applications.find(
      (candidate) =>
        candidate?.type === SALTO_APP.type && candidate?.id === SALTO_APP.id,
    );
    if ((app.iqActivations || []).some(isUnstamped)) {
      stamps.push({ tenant, identity: await identityOf(tenant, app) });
    }
  }

  if (stamps.length === 0) {
    return;
  }

  // One batch for every tenant; the driver refuses an empty one.
  await Tenant.collection.bulkWrite(
    stamps.map(({ tenant, identity }) => ({
      updateOne: {
        filter: { _id: tenant._id },
        update: {
          $set: Object.fromEntries(
            Object.entries(identity).map(([field, value]) => [
              `applications.$[app].iqActivations.$[entry].${field}`,
              value,
            ]),
          ),
        },
        arrayFilters: [
          { "app.type": SALTO_APP.type, "app.id": SALTO_APP.id },
          { "entry.siteId": { $exists: false } },
        ],
      },
    })),
  );
}

module.exports = {
  name: NAME,

  up: async function (mongoose) {
    await stampIqActivations(mongoose);
  },

  down: async function () {
    // Not reversed: versions before 4.4.0 ignore the stamp.
  },
};
