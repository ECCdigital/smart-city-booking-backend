/**
 * A report (glossary „Meldung (eines Users oder einer Adresse)“,
 * ECCdigital/tickets#630): a tenant tells the instance about a user it
 * wants suspended, with a reason and, where it reports from a booking, the
 * booking as evidence. The instance owner settles it with a suspension or
 * rejects it with a reason. A tenant has at most one open report per
 * target; a second report adds to it (`additions`).
 */

const REPORT_STATUS = Object.freeze({
  OPEN: "open",
  SUSPENDED: "suspended",
  REJECTED: "rejected",
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
  targetUserId: { type: String, required: true },
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
