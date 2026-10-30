/**
 * A report (glossary „Meldung (eines Users oder einer Adresse)“):
 * a tenant tells the instance about a user it
 * wants suspended, with a reason and, where it reports from a booking, the
 * booking as evidence. The instance owner settles it with a suspension or
 * rejects it with a reason. The target is a user (`targetUserId`) or the
 * normalized address of a guest (`targetAddress`),
 * never both; a report about an address is settled with a blacklist entry
 * (`blacklisted`) instead of a suspension. A tenant has at most one open
 * report per target; a second report adds to it (`additions`). The
 * tenant may withdraw an open report of its own.
 */

const REPORT_STATUS = Object.freeze({
  OPEN: "open",
  SUSPENDED: "suspended",
  BLACKLISTED: "blacklisted",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
});

const additionSchemaDefinition = {
  _id: false,
  reason: { type: String, required: true },
  bookingId: { type: String, default: null },
  reportedBy: { type: String, required: true },
  reportedAt: { type: Number, required: true },
};

const reportSchemaDefinition = {
  id: { type: String, required: true },
  tenantId: { type: String, required: true },
  targetUserId: { type: String, default: null },
  targetAddress: { type: String, default: null },
  reason: { type: String, required: true },
  bookingId: { type: String, default: null },
  reportedBy: { type: String, required: true },
  reportedAt: { type: Number, required: true },
  additions: { type: [additionSchemaDefinition], default: [] },
  status: {
    type: String,
    required: true,
    enum: Object.values(REPORT_STATUS),
    default: REPORT_STATUS.OPEN,
  },
  rejectionReason: { type: String, default: null },
  resolvedAt: { type: Number, default: null },
  resolvedBy: { type: String, default: null },
};

module.exports = { reportSchemaDefinition, REPORT_STATUS };
