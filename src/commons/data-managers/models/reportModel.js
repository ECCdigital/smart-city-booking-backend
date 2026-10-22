const mongoose = require("mongoose");
const { reportSchemaDefinition } = require("../../schemas/reportSchema");

const { Schema } = mongoose;

const ReportSchema = new Schema(reportSchemaDefinition);

ReportSchema.index({ id: 1 }, { unique: true });
// At most one open report per tenant and target: a second one fails here.
ReportSchema.index(
  { tenantId: 1, targetUserId: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);
ReportSchema.index({ status: 1, targetUserId: 1 });

module.exports =
  mongoose.models.Report || mongoose.model("Report", ReportSchema, "reports");
