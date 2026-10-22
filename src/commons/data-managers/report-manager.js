const ReportModel = require("./models/reportModel");
const { REPORT_STATUS } = require("../schemas/reportSchema");

/** A stored report as a plain object, without the keys of MongoDB. */
const plain = (doc) => {
  if (!doc) return null;
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, ...report } = doc.toObject();
  return report;
};

/**
 * Data manager of the reports (glossary „Meldung“, ECCdigital/tickets#630)
 * in their own collection. The service decides who reads which; no read
 * here takes a reach.
 */
class ReportManager {
  /**
   * @param {string} tenantId The reporting tenant
   * @param {string} targetUserId The user reported
   * @returns {Promise<Object|null>} The open report of the tenant about
   *   the target, if there is one
   */
  static async getOpenReport(tenantId, targetUserId) {
    return plain(
      await ReportModel.findOne({
        tenantId,
        targetUserId,
        status: REPORT_STATUS.OPEN,
      }),
    );
  }

  /**
   * @param {Object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.targetUserId]
   * @returns {Promise<Object[]>} The reports, oldest first
   */
  static async getReports({ status, targetUserId } = {}) {
    const query = {};
    if (status) query.status = status;
    if (targetUserId) query.targetUserId = targetUserId;
    const docs = await ReportModel.find(query).sort({ reportedAt: 1 });
    return docs.map(plain);
  }

  /**
   * Stores a new report; a second open one of the tenant about the same
   * target fails at the partial index (code 11000).
   * @param {Object} report The report as `reportSchema` describes it
   * @returns {Promise<Object>}
   */
  static async insertReport(report) {
    return plain(await ReportModel.create(report));
  }

  /**
   * Adds a reason to a report that is still open.
   * @param {string} id The report
   * @param {{reason: string, bookingId: string|null, reportedBy: string, reportedAt: number}} addition
   * @returns {Promise<Object|null>} The report after the write, `null`
   *   where it is not open anymore
   */
  static async addToOpenReport(id, addition) {
    return plain(
      await ReportModel.findOneAndUpdate(
        { id, status: REPORT_STATUS.OPEN },
        { $push: { additions: addition } },
        { new: true },
      ),
    );
  }

  /**
   * Settles every open report about a target with the given fields.
   * @param {string} targetUserId The user reported
   * @param {{status: string, rejectionReason: string|null, resolvedAt: number, resolvedBy: string}} fields
   * @returns {Promise<Object[]>} The reports settled by this write
   */
  static async resolveOpenReports(targetUserId, fields) {
    const open = await ReportModel.find({
      targetUserId,
      status: REPORT_STATUS.OPEN,
    });
    const ids = open.map((doc) => doc.id);
    if (ids.length === 0) return [];
    await ReportModel.updateMany(
      { id: { $in: ids }, status: REPORT_STATUS.OPEN },
      { $set: fields },
    );
    const docs = await ReportModel.find({ id: { $in: ids }, ...fields });
    return docs.map(plain);
  }
}

module.exports = ReportManager;
