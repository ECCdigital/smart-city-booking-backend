const mongoose = require("mongoose");
const tokenSessionSchemaDefinition = {
  jti: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  tokenType: { type: String, required: true, enum: ['access', 'refresh'] },
  status: { type: String, required: true, enum: ['active', 'revoked'], default: 'active' },
  issuedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: null },
  deviceId: { type: String, default: null },
};

const TokenSessionSchema = new mongoose.Schema(tokenSessionSchemaDefinition, {
  collection: "tokensessions",
  timestamps: true,
});

TokenSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

TokenSessionSchema.index({ userId: 1, status: 1 });
TokenSessionSchema.index({ jti: 1, status: 1 });

const TokenSessionModel = mongoose.model("TokenSession", TokenSessionSchema);

module.exports = {
  tokenSessionSchemaDefinition,
  TokenSessionSchema,
  TokenSessionModel,
};

