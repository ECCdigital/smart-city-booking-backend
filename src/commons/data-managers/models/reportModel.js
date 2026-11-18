const mongoose = require("mongoose");
const { reportSchemaDefinition } = require("../../schemas/reportSchema");

const { Schema } = mongoose;

const ReportSchema = new Schema(reportSchemaDefinition);

ReportSchema.index({ id: 1 }, { unique: true });
// At most one open report per tenant and target, a user or an address:
// a second one fails here.
ReportSchema.index(
  { tenantId: 1, targetUserId: 1 },
  {
    unique: true,
    name: "open_report_per_tenant_and_user",
    partialFilterExpression: {
      status: "open",
      targetUserId: { $type: "string" },
    },
  },
);
ReportSchema.index(
  { tenantId: 1, targetAddress: 1 },
  {
    unique: true,
    name: "open_report_per_tenant_and_address",
    partialFilterExpression: {
      status: "open",
      targetAddress: { $type: "string" },
    },
  },
);
ReportSchema.index({ status: 1, targetUserId: 1 });
ReportSchema.index({ status: 1, targetAddress: 1 });

module.exports =
  mongoose.models.Report || mongoose.model("Report", ReportSchema, "reports");
