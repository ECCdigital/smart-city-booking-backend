const mongoose = require("mongoose");
const { bookableSchemaDefinition } = require("../../schemas/bookableSchema");

const { Schema } = mongoose;

const BookableSchema = new Schema(bookableSchemaDefinition);

BookableSchema.index({ tenantId: 1, id: 1 });

// --- Temp IFBS Provider Sync Logic ---
function hasActiveIfbsLocker(doc) {
  return (
    doc.lockerDetails?.active === true &&
    Array.isArray(doc.lockerDetails?.units) &&
    doc.lockerDetails.units.some((u) => u.lockerSystem === "ifbs")
  );
}

function ensureIfbsProvider(doc) {
  if (!doc) return;

  if (!Array.isArray(doc.externalProviders)) {
    doc.externalProviders = [];
  }

  const existingIndex = doc.externalProviders.findIndex(
    (p) => p.provider === "ifbs",
  );

  if (hasActiveIfbsLocker(doc)) {
    const ifbsUnit = doc.lockerDetails.units.find(
      (u) => u.lockerSystem === "ifbs",
    );

    const providerEntry = {
      provider: "ifbs",
      handles: ["pricing", "availability", "maxAmount"],
      config: {
        locationId: ifbsUnit.locationId ?? null,
        amount: 1,
      },
    };

    if (existingIndex >= 0) {
      doc.externalProviders[existingIndex] = providerEntry;
    } else {
      doc.externalProviders.push(providerEntry);
    }
  } else {
    if (existingIndex >= 0) {
      doc.externalProviders.splice(existingIndex, 1);
    }
  }
}

BookableSchema.pre("save", function (next) {
  ensureIfbsProvider(this);
  next();
});

function preUpdateHook(next) {
  const update = this.getUpdate();
  if (update) {
    ensureIfbsProvider(update);
    if (update.$set) {
      ensureIfbsProvider(update.$set);
    }
  }
  next();
}

BookableSchema.pre("updateOne", preUpdateHook);
BookableSchema.pre("findOneAndUpdate", preUpdateHook);

function postFindHook(docs) {
  if (!docs) return;
  const list = Array.isArray(docs) ? docs : [docs];
  list.forEach((doc) => ensureIfbsProvider(doc));
}

BookableSchema.post("find", postFindHook);
BookableSchema.post("findOne", postFindHook);


BookableSchema.statics.applyIfbsProvider = function (docs) {
  const list = Array.isArray(docs) ? docs : [docs];
  list.forEach((doc) => ensureIfbsProvider(doc));
  return docs;
};

BookableSchema.methods.toEntity = function () {
  const { Bookable } = require("../../entities/bookable/bookable");
  return new Bookable(this.toObject());
};

module.exports =
  mongoose.models.Bookable || mongoose.model("Bookable", BookableSchema);
