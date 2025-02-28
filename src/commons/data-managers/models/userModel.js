const mongoose = require("mongoose");
const { User } = require("../../entities/user");
const { Schema } = mongoose;

const UserSchema = new Schema(User.schema());

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
