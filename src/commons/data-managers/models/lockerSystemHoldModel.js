const mongoose = require("mongoose");
const def = require("../../schemas/lockerSystemHoldSchema");

const { Schema } = mongoose;

const LockerSystemHoldSchema = new Schema(def, { versionKey: false });

// One hold per locker system: the unique key makes a second acquire fail.
LockerSystemHoldSchema.index({ key: 1 }, { unique: true });
// Expired holds are only tidied up here; an acquire already ignores them.
LockerSystemHoldSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.LockerSystemHold ||
  mongoose.model("LockerSystemHold", LockerSystemHoldSchema);
