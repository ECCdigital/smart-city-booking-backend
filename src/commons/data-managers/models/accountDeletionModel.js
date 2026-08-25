const mongoose = require("mongoose");
const accountDeletionSchemaDefinition = require("../../schemas/accountDeletionSchema");

const { Schema } = mongoose;

const AccountDeletionSchema = new Schema(accountDeletionSchemaDefinition);

AccountDeletionSchema.index(
  { tenantId: 1, role: 1, reasonId: 1, period: 1 },
  { unique: true },
);

AccountDeletionSchema.methods.toEntity = function () {
  const AccountDeletion = require("../../entities/stats/accountDeletion");
  return new AccountDeletion(this.toObject());
};

module.exports =
  mongoose.models.AccountDeletion ||
  mongoose.model("AccountDeletion", AccountDeletionSchema, "account_deletions");
