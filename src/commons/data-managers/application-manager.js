const Application = require("../entities/student/application");
const ApplicationModel = require("./models/applicationModel");

class ApplicationManager {
  static async getByOfferAndUser(tenantId, offerId, studentUserId) {
    const raw = await ApplicationModel.findOne({
      tenantId,
      offerId,
      studentUserId,
    });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async listByUser(tenantId, studentUserId) {
    const raw = await ApplicationModel.find({ tenantId, studentUserId }).sort({
      created: -1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async storeApplication(application) {
    const entity =
      application instanceof Application
        ? application
        : new Application(application);
    entity.validate();
    await ApplicationModel.updateOne(
      { tenantId: entity.tenantId, id: entity.id },
      { $set: { ...entity } },
      { upsert: true },
    );
    return entity;
  }

  static async getById(tenantId, id) {
    const raw = await ApplicationModel.findOne({ tenantId, id });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async getByCompany(tenantId, companyId) {
    const raw = await ApplicationModel.find({ tenantId, companyId }).sort({
      created: -1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async getByOffer(tenantId, offerId) {
    const raw = await ApplicationModel.find({ tenantId, offerId });
    return raw.map((doc) => doc.toEntity());
  }

  // application counts per offer as { offerId: count } (single aggregate)
  static async countByOffers(tenantId, offerIds) {
    const counts = {};
    if (!Array.isArray(offerIds) || offerIds.length === 0) {
      return counts;
    }
    const rows = await ApplicationModel.aggregate([
      { $match: { tenantId, offerId: { $in: offerIds } } },
      { $group: { _id: "$offerId", count: { $sum: 1 } } },
    ]);
    for (const row of rows) {
      counts[row._id] = row.count;
    }
    return counts;
  }

  static async countByStudents(tenantId, studentUserIds) {
    const counts = {};
    if (!Array.isArray(studentUserIds) || studentUserIds.length === 0) {
      return counts;
    }
    const rows = await ApplicationModel.aggregate([
      { $match: { tenantId, studentUserId: { $in: studentUserIds } } },
      { $group: { _id: "$studentUserId", count: { $sum: 1 } } },
    ]);
    for (const row of rows) {
      counts[row._id] = row.count;
    }
    return counts;
  }

  static async removeById(tenantId, id) {
    await ApplicationModel.deleteOne({ tenantId, id });
  }

  static async removeByOffer(tenantId, offerId) {
    await ApplicationModel.deleteMany({ tenantId, offerId });
  }

  static async removeByCompany(tenantId, companyId) {
    await ApplicationModel.deleteMany({ tenantId, companyId });
  }

  static async getAllByStudent(studentUserId) {
    const raw = await ApplicationModel.find({ studentUserId });
    return raw.map((doc) => doc.toEntity());
  }

  static async removeByStudentAllTenants(studentUserId) {
    await ApplicationModel.deleteMany({ studentUserId });
  }

  static async updateStatus(tenantId, id, status) {
    await ApplicationModel.updateOne({ tenantId, id }, { $set: { status } });
  }

  static async addDocument(tenantId, id, document) {
    await ApplicationModel.updateOne(
      { tenantId, id },
      { $push: { documents: document } },
    );
  }

  static async removeDocument(tenantId, id, documentId) {
    await ApplicationModel.updateOne(
      { tenantId, id },
      { $pull: { documents: { id: documentId } } },
    );
  }
  static async countByField(tenantId, field, value) {
    return ApplicationModel.countDocuments({ tenantId, [field]: value });
  }

  // Application counts grouped by status, optionally scoped to one company.
  static async aggregateByStatus(tenantId, companyId) {
    const match = { tenantId };
    if (companyId) {
      match.companyId = companyId;
    }
    const rows = await ApplicationModel.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    return rows.map((row) => ({ status: row._id, count: row.count }));
  }

  // monthly application counts, ascending: [{ period: "YYYY-MM", count }]
  static async aggregateMonthly(tenantId, companyId, months = 12) {
    const match = { tenantId };
    if (companyId) {
      match.companyId = companyId;
    }
    const now = new Date();
    match.created = {
      $gte: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    };
    const rows = await ApplicationModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: { $toDate: "$created" } },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((row) => ({ period: row._id, count: row.count }));
  }
}

module.exports = ApplicationManager;
