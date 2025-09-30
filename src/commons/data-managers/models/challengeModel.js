const mongoose = require("mongoose");
const def = require("../../schemas/challengeSchema");

const { Schema } = mongoose;

const ChallengeSchema = new Schema(def, {
  timestamps: true,
});

ChallengeSchema.index({ tenantId: 1, label: 1 }, { unique: true });

ChallengeSchema.methods.toEntity = function () {
  const Challenge = require("../../entities/tenant/challenge");
  return new Challenge(this.toObject());
};

module.exports =
  mongoose.models.Challenge || mongoose.model("Challenge", ChallengeSchema);
