const sinon = require("sinon");

const ReportManager = require("../../src/commons/data-managers/report-manager");

/**
 * The reports in memory, behind `ReportManager` (glossary „Meldung“,
 * ECCdigital/tickets#630): every method of the manager over an array, at
 * most one open report per tenant and target as the partial index keeps
 * it. Answers the array, so a test reads back what is stored.
 */
function installReportCollection(documents = []) {
  const docs = documents.map((doc) => ({ ...doc }));
  const copy = (doc) => doc && JSON.parse(JSON.stringify(doc));
  const isOpen = (doc) => doc.status === "open";

  sinon
    .stub(ReportManager, "getOpenReport")
    .callsFake(
      async (tenantId, targetUserId) =>
        copy(
          docs.find(
            (doc) =>
              isOpen(doc) &&
              doc.tenantId === tenantId &&
              doc.targetUserId === targetUserId,
          ),
        ) ?? null,
    );
  sinon
    .stub(ReportManager, "getReports")
    .callsFake(async ({ status, targetUserId } = {}) =>
      docs
        .filter((doc) => !status || doc.status === status)
        .filter((doc) => !targetUserId || doc.targetUserId === targetUserId)
        .sort((a, b) => a.reportedAt - b.reportedAt)
        .map(copy),
    );
  sinon.stub(ReportManager, "insertReport").callsFake(async (report) => {
    if (
      isOpen(report) &&
      docs.some(
        (doc) =>
          isOpen(doc) &&
          doc.tenantId === report.tenantId &&
          doc.targetUserId === report.targetUserId,
      )
    ) {
      const error = new Error("E11000 duplicate key error: open report");
      error.code = 11000;
      throw error;
    }
    docs.push(copy(report));
    return copy(report);
  });
  sinon
    .stub(ReportManager, "addToOpenReport")
    .callsFake(async (id, addition) => {
      const doc = docs.find((candidate) => candidate.id === id);
      if (!doc || !isOpen(doc)) return null;
      doc.additions = [...(doc.additions ?? []), copy(addition)];
      return copy(doc);
    });
  sinon
    .stub(ReportManager, "resolveOpenReports")
    .callsFake(async (targetUserId, fields) => {
      const resolved = docs.filter(
        (doc) => isOpen(doc) && doc.targetUserId === targetUserId,
      );
      for (const doc of resolved) Object.assign(doc, copy(fields));
      return resolved.map(copy);
    });

  return docs;
}

module.exports = { installReportCollection };
