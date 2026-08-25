const AccountDeletionManager = require("../data-managers/account-deletion-manager");
const TaxonomyTermManager = require("../data-managers/taxonomy-term-manager");

const ROLES = ["student", "company"];

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

class AccountDeletionService {
  static async assertValidReason(tenantId, role, reason) {
    if (!ROLES.includes(role)) {
      throw { message: "Invalid role", status: 400 };
    }
    const reasonId = String(reason || "").trim();
    const term = reasonId
      ? await TaxonomyTermManager.getTerm(tenantId, reasonId)
      : null;
    if (!term || term.type !== `deletion_reason_${role}`) {
      throw { message: "A valid deletion reason is required", status: 400 };
    }
    return reasonId;
  }

  static async increment(tenantId, role, reasonId) {
    await AccountDeletionManager.increment(
      tenantId,
      role,
      reasonId,
      currentPeriod(),
    );
  }

  static async record(tenantId, role, reason) {
    const reasonId = await AccountDeletionService.assertValidReason(
      tenantId,
      role,
      reason,
    );
    await AccountDeletionService.increment(tenantId, role, reasonId);
  }

  static async getStats(tenantId, role) {
    if (!ROLES.includes(role)) {
      throw { message: "Invalid role", status: 400 };
    }
    const [rows, terms] = await Promise.all([
      AccountDeletionManager.list(tenantId, role),
      TaxonomyTermManager.getTerms(tenantId, {
        type: `deletion_reason_${role}`,
        activeOnly: false,
      }),
    ]);
    const names = new Map(terms.map((term) => [term.id, term.name]));
    const totals = new Map();
    for (const row of rows) {
      totals.set(row.reasonId, (totals.get(row.reasonId) || 0) + row.count);
    }
    return Array.from(totals.entries())
      .map(([reasonId, count]) => ({
        reasonId,
        name: names.get(reasonId) || reasonId,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }
}

module.exports = AccountDeletionService;
