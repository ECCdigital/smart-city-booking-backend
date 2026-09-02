const mongoose = require("mongoose");
const { bookableSchemaDefinition } = require("../../schemas/bookableSchema");
const { ensureIfbsProvider } = require("./bookable-ifbs-provider");

const { Schema } = mongoose;

const BookableSchema = new Schema(bookableSchemaDefinition);

BookableSchema.index({ tenantId: 1, id: 1 });

/**
 * The iFBS location of the bookable's locker system, read off the locker
 * rows it references while its access points are switched on. `null`
 * where it references no iFBS locker system.
 */
async function ifbsLocationOf(doc, tenantId) {
  const details = doc.accessPointDetails;
  const ids = details?.active === true ? details.accessPointIds || [] : [];
  if (!ids.length || !tenantId) {
    return null;
  }

  const AccessPointModel = require("./accessPointModel");
  const row = await AccessPointModel.findOne({
    tenantId: tenantId,
    id: { $in: ids.map(String) },
    type: "locker",
    provider: "ifbs",
  }).lean();

  return row?.externalId ?? null;
}

// The iFBS price provider of `externalProviders` follows the bookable's
// iFBS locker system at write time; the stored entry is what the checkout
// reads, so nothing is derived on the way out.
BookableSchema.pre("save", async function () {
  ensureIfbsProvider(this, await ifbsLocationOf(this, this.tenantId));
});

async function preUpdateHook() {
  const update = this.getUpdate();
  if (!update) {
    return;
  }

  const target = update.$set || update;
  if (!target.accessPointDetails) {
    return;
  }

  const tenantId = target.tenantId || this.getFilter()?.tenantId;
  ensureIfbsProvider(target, await ifbsLocationOf(target, tenantId));
}

BookableSchema.pre("updateOne", preUpdateHook);
BookableSchema.pre("findOneAndUpdate", preUpdateHook);

BookableSchema.methods.toEntity = function (customFieldDefs) {
  const { Bookable } = require("../../entities/bookable/bookable");
  const entity = new Bookable(this.toObject());

  if (customFieldDefs) {
    entity.enrichCustomFields(customFieldDefs);
  }

  return entity;
};

module.exports =
  mongoose.models.Bookable || mongoose.model("Bookable", BookableSchema);
