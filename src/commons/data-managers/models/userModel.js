const mongoose = require("mongoose");
const { userSchemaDefinition } = require("../../schemas/userSchema");
const { Schema } = mongoose;

const UserSchema = new Schema(userSchemaDefinition);

UserSchema.index(
  { "cardAuth.appId": 1, "cardAuth.publicId": 1 },
  { unique: true, sparse: true, name: "cardAuth_app_public_idx" },
);

UserSchema.index(
  { keycloakId: 1 },
  {
    unique: true,
    name: "keycloakId_unique_idx",
    partialFilterExpression: { keycloakId: { $type: "string", $ne: "" } },
  },
);

UserSchema.methods.toEntity = function () {
  const { User } = require("../../entities/user/user");
  return new User(this.toObject());
};

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
