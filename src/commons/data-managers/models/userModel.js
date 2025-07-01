const mongoose = require("mongoose");
const { userSchemaDefinition } = require("../../schemas/userSchema");
const { Schema } = mongoose;

const UserSchema = new Schema(userSchemaDefinition);

UserSchema.methods.toEntity = function () {
  const { User } = require("../../entities/user/user");
  return new User(this.toObject());
};

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
