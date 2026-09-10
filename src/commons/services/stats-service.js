const ApplicationManager = require("../data-managers/application-manager");
const CompanyManager = require("../data-managers/company-manager");
const CompanyBranchManager = require("../data-managers/company-branch-manager");
const TaxonomyTermManager = require("../data-managers/taxonomy-term-manager");

const MONTHS_WINDOW = 12;

class StatsService {
  // locations per district = company HQ + every branch (HQ is not a branch)
  static async locationsByDistrict(tenantId) {
    const [companies, branches] = await Promise.all([
      CompanyManager.countByDistrict(tenantId),
      CompanyBranchManager.countByDistrict(tenantId),
    ]);
    const totals = new Map();
    for (const { districtId, count } of [...companies, ...branches]) {
      if (!districtId) {
        continue;
      }
      totals.set(districtId, (totals.get(districtId) || 0) + count);
    }
    return Array.from(totals.entries())
      .map(([districtId, count]) => ({ districtId, count }))
      .sort((a, b) => b.count - a.count);
  }

  // admin dashboard aggregates; companyId scopes the application figures
  static async getStats(tenantId, companyId) {
    const [terms, statusRows, monthly, locationsByDistrict] = await Promise.all(
      [
        TaxonomyTermManager.getTerms(tenantId, {
          type: "application_status",
          activeOnly: false,
        }),
        ApplicationManager.aggregateByStatus(tenantId, companyId),
        ApplicationManager.aggregateMonthly(tenantId, companyId, MONTHS_WINDOW),
        StatsService.locationsByDistrict(tenantId),
      ],
    );
    const termIds = new Set(terms.map((term) => term.id));
    const counts = new Map(statusRows.map((row) => [row.status, row.count]));
    const byStatus = terms.map((term) => ({
      status: term.name,
      count: counts.get(term.id) || 0,
    }));
    const orphaned = statusRows
      .filter((row) => !termIds.has(row.status))
      .reduce((sum, row) => sum + row.count, 0);
    if (orphaned > 0) {
      byStatus.push({ status: "—", count: orphaned });
    }
    return { applications: { byStatus, monthly }, locationsByDistrict };
  }
}

module.exports = StatsService;
