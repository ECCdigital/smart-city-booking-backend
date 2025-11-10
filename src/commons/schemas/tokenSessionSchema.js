const mongoose = require("mongoose");

/**
 * Schema für Token-Sessions/Blacklist
 * Speichert invalidierte Tokens in MongoDB
 */
const tokenSessionSchemaDefinition = {
  jti: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  tokenType: { type: String, required: true, enum: ['access', 'refresh'] },
  status: { type: String, required: true, enum: ['active', 'revoked'], default: 'active' },
  issuedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: true },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: null },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
  deviceId: { type: String, default: null },
  metadata: { type: Object, default: {} },
};

const TokenSessionSchema = new mongoose.Schema(tokenSessionSchemaDefinition, {
  collection: "tokensessions",
  timestamps: true,
});

// Index für automatisches Löschen abgelaufener Tokens
TokenSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index für Queries
TokenSessionSchema.index({ userId: 1, status: 1 });
TokenSessionSchema.index({ jti: 1, status: 1 });

const TokenSessionModel = mongoose.model("TokenSession", TokenSessionSchema);

module.exports = {
  tokenSessionSchemaDefinition,
  TokenSessionSchema,
  TokenSessionModel,
};

