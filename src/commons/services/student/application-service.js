const { v4: uuidv4 } = require("uuid");
const ApplicationManager = require("../../data-managers/application-manager");
const OfferManager = require("../../data-managers/offer-manager");
const StudentManager = require("../../data-managers/student-manager");
const UserManager = require("../../data-managers/user-manager");
const CompanyBranchManager = require("../../data-managers/company-branch-manager");
const CompanyManager = require("../../data-managers/company-manager");
const CompanyMemberManager = require("../../data-managers/company-member-manager");
const TaxonomyTermManager = require("../../data-managers/taxonomy-term-manager");
const PlatformSettingsService = require("../platform-settings-service");
const { NextcloudManager } = require("../../data-managers/file-manager");
const AuditLogService = require("../audit-log-service");
const ApplicationNotificationMail = require("./application-notification-mail");

const MOTIVATION_MAX = 5000;

function deriveAge(birthDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || "")) {
    return null;
  }
  const born = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) {
    return null;
  }
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function toDocDto(tenantId, applicationId, doc) {
  return {
    id: doc.id,
    type: doc.type,
    name: doc.originalName,
    size: doc.size,
    created: doc.created,
    downloadUrl: `${process.env.BACKEND_URL}/api/${tenantId}/applications/${applicationId}/documents/${doc.id}/download`,
  };
}

function toListDto(tenantId, application, offer, statusName) {
  return {
    id: application.id,
    offerId: application.offerId,
    companyId: application.companyId,
    isUnsolicited: application.isUnsolicited === true,
    statusId: application.status,
    status: statusName,
    createdAt: application.created,
    offer: offer
      ? {
          id: offer.id,
          title: offer.title,
          city: offer.city,
          companyId: offer.companyId,
          status: offer.status,
        }
      : null,
    documents: (application.documents || []).map((doc) =>
      toDocDto(tenantId, application.id, doc),
    ),
  };
}

function toCompanyDto(
  tenantId,
  application,
  offer,
  branchName,
  statusName,
  branchId,
) {
  return {
    id: application.id,
    offerId: application.offerId,
    offerTitle: offer ? offer.title : null,
    isUnsolicited: application.isUnsolicited === true,
    branchId: branchId !== undefined ? branchId : application.branchId,
    branchName: branchName || null,
    applicant: {
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      birthDate: application.birthDate,
      age: deriveAge(application.birthDate),
    },
    motivation: application.motivation,
    statusId: application.status,
    status: statusName,
    createdAt: application.created,
    documents: (application.documents || []).map((doc) =>
      toDocDto(tenantId, application.id, doc),
    ),
  };
}

async function statusNameMap(tenantId) {
  const terms = await TaxonomyTermManager.getTerms(tenantId, {
    type: "application_status",
    activeOnly: false,
  });
  return new Map(terms.map((term) => [term.id, term.name]));
}

function isDeadlinePassed(deadline) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return false;
  }
  return deadline < new Date().toISOString().slice(0, 10);
}

class ApplicationService {
  static async _companyManagerRecipients(tenantId, companyId, branchId) {
    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );
    const scope = branchId || "";
    const emails = members
      .filter((m) => m.isOwner === true || !m.branchId || m.branchId === scope)
      .map((m) => m.userId)
      .filter(Boolean);
    return [...new Set(emails)];
  }

  static async submitApplication(tenantId, userId, offerId, payload) {
    const data = payload || {};

    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Only students can apply", status: 403 };
    }

    if (data.consent !== true) {
      throw { message: "Consent is required", status: 400 };
    }

    const motivation = String(data.motivation || "").trim();
    if (motivation.length > MOTIVATION_MAX) {
      throw {
        message: `Motivation must be at most ${MOTIVATION_MAX} characters`,
        status: 400,
      };
    }

    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer || offer.status !== "Online") {
      throw { message: "Offer not found", status: 404 };
    }
    const company = await CompanyManager.getCompany(tenantId, offer.companyId);
    if (!company || company.status === "blocked") {
      throw { message: "Offer not found", status: 404 };
    }
    if (isDeadlinePassed(offer.applicationDeadline)) {
      throw {
        message: "The application deadline for this offer has passed",
        status: 409,
      };
    }

    const existing = await ApplicationManager.getByOfferAndUser(
      tenantId,
      offerId,
      userId,
    );
    if (existing) {
      throw {
        message: "You have already applied to this offer",
        status: 409,
      };
    }

    const user = await UserManager.getUserBy({ id: userId }, false);
    if (!user) {
      throw { message: "User not found", status: 404 };
    }

    const settings = await PlatformSettingsService.getSettings(tenantId);
    const initialStatus = settings.defaultApplicationStatus;

    const now = Date.now();
    let application;
    try {
      application = await ApplicationManager.storeApplication({
        id: uuidv4(),
        tenantId,
        offerId,
        companyId: offer.companyId,
        branchId: offer.branchId || "",
        studentUserId: userId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.id,
        phone: user.phone,
        birthDate: student.birthDate,
        motivation,
        consent: true,
        consentAt: now,
        status: initialStatus,
        documents: [],
        created: now,
      });
    } catch (err) {
      // concurrent submit may collide on the unique index → same 409 as the pre-check
      if (err && err.code === 11000) {
        throw {
          message: "You have already applied to this offer",
          status: 409,
        };
      }
      throw err;
    }

    await AuditLogService.record(
      tenantId,
      "create",
      `${user.id} hat sich auf „${offer.title}" beworben`,
    );

    (async () => {
      const recipients = await ApplicationService._companyManagerRecipients(
        tenantId,
        offer.companyId,
        offer.branchId || "",
      );
      await ApplicationNotificationMail.sendApplicationReceived({
        recipients,
        companyName: company.name,
        applicantName: `${user.firstName} ${user.lastName}`.trim(),
        offerTitle: offer.title,
        isUnsolicited: false,
      });
    })().catch((error) =>
      AuditLogService.record(
        tenantId,
        "error",
        `Benachrichtigung über neue Bewerbung konnte nicht gesendet werden: ${error?.message || error}`,
      ),
    );

    return { id: application.id };
  }

  static async submitUnsolicitedApplication(
    tenantId,
    userId,
    companyId,
    payload,
  ) {
    const data = payload || {};

    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Only students can apply", status: 403 };
    }

    if (data.consent !== true) {
      throw { message: "Consent is required", status: 400 };
    }

    const motivation = String(data.motivation || "").trim();
    if (motivation.length > MOTIVATION_MAX) {
      throw {
        message: `Motivation must be at most ${MOTIVATION_MAX} characters`,
        status: 400,
      };
    }

    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company || company.status === "blocked") {
      throw { message: "Company not found", status: 404 };
    }
    if (company.acceptsUnsolicitedApplications !== true) {
      throw {
        message: "This company is not accepting unsolicited applications",
        status: 409,
      };
    }

    const user = await UserManager.getUserBy({ id: userId }, false);
    if (!user) {
      throw { message: "User not found", status: 404 };
    }

    const settings = await PlatformSettingsService.getSettings(tenantId);
    const now = Date.now();
    const application = await ApplicationManager.storeApplication({
      id: uuidv4(),
      tenantId,
      offerId: "",
      companyId,
      branchId: "",
      isUnsolicited: true,
      studentUserId: userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.id,
      phone: user.phone,
      birthDate: student.birthDate,
      motivation,
      consent: true,
      consentAt: now,
      status: settings.defaultApplicationStatus,
      documents: [],
      created: now,
    });

    await AuditLogService.record(
      tenantId,
      "create",
      `${user.id} hat eine Initiativbewerbung bei „${company.name}" abgeschickt`,
    );

    (async () => {
      const recipients = await ApplicationService._companyManagerRecipients(
        tenantId,
        companyId,
        "",
      );
      await ApplicationNotificationMail.sendApplicationReceived({
        recipients,
        companyName: company.name,
        applicantName: `${user.firstName} ${user.lastName}`.trim(),
        offerTitle: null,
        isUnsolicited: true,
      });
    })().catch((error) =>
      AuditLogService.record(
        tenantId,
        "error",
        `Benachrichtigung über neue Initiativbewerbung konnte nicht gesendet werden: ${error?.message || error}`,
      ),
    );

    return { id: application.id };
  }

  static async listMyApplications(tenantId, userId) {
    const all = await ApplicationManager.listByUser(tenantId, userId);
    const blocked = new Set(
      await CompanyManager.getBlockedCompanyIds(tenantId),
    );
    const applications = all.filter((a) => !blocked.has(a.companyId));
    if (applications.length === 0) {
      return [];
    }
    const offers = await OfferManager.getOffersByIds(
      tenantId,
      applications.map((application) => application.offerId),
    );
    const byId = new Map(offers.map((offer) => [offer.id, offer]));
    const names = await statusNameMap(tenantId);
    return applications.map((application) =>
      toListDto(
        tenantId,
        application,
        byId.get(application.offerId) || null,
        names.get(application.status) || "—",
      ),
    );
  }

  static async listCompanyApplications(tenantId, companyId, branchScope) {
    const applications = await ApplicationManager.getByCompany(
      tenantId,
      companyId,
    );
    if (applications.length === 0) {
      return [];
    }
    const offers = await OfferManager.getOffersByIds(
      tenantId,
      applications.map((a) => a.offerId),
    );
    const offerById = new Map(offers.map((offer) => [offer.id, offer]));
    // scope by the offer's CURRENT branch, not the value snapshotted at submit
    const branchOf = (a) => {
      const offer = offerById.get(a.offerId);
      return (offer ? offer.branchId : a.branchId) || "";
    };
    const scoped =
      branchScope !== null && branchScope !== undefined
        ? applications.filter((a) => branchOf(a) === branchScope)
        : applications;
    if (scoped.length === 0) {
      return [];
    }
    const branches = await CompanyBranchManager.getBranchesByCompany(
      tenantId,
      companyId,
    );
    const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
    const names = await statusNameMap(tenantId);
    return scoped.map((application) => {
      const branchId = branchOf(application);
      return toCompanyDto(
        tenantId,
        application,
        offerById.get(application.offerId) || null,
        branchId ? branchNameById.get(branchId) || null : null,
        names.get(application.status) || "—",
        branchId,
      );
    });
  }

  static async updateApplicationStatus(
    tenantId,
    companyId,
    applicationId,
    status,
    branchScope,
  ) {
    const statusTerms = await TaxonomyTermManager.getTerms(tenantId, {
      type: "application_status",
    });
    if (!statusTerms.some((term) => term.id === status)) {
      throw { message: "Invalid status", status: 400 };
    }
    const application = await ApplicationManager.getById(
      tenantId,
      applicationId,
    );
    if (!application || application.companyId !== companyId) {
      throw { message: "Application not found", status: 404 };
    }
    if (branchScope !== null && branchScope !== undefined) {
      // Scope by the offer's CURRENT branch (see listCompanyApplications).
      const offer = await OfferManager.getOffer(tenantId, application.offerId);
      const branchId = (offer ? offer.branchId : application.branchId) || "";
      if (branchId !== branchScope) {
        throw { message: "Out of branch scope", status: 403 };
      }
    }
    const oldStatusName =
      statusTerms.find((term) => term.id === application.status)?.name ||
      application.status;
    await ApplicationManager.updateStatus(tenantId, applicationId, status);
    const statusName = statusTerms.find((term) => term.id === status).name;
    await AuditLogService.record(
      tenantId,
      "update",
      `Bewerbung von ${application.email} auf „${statusName}" gesetzt`,
    );

    (async () => {
      const company = await CompanyManager.getCompany(
        tenantId,
        application.companyId,
      );
      const offer = application.offerId
        ? await OfferManager.getOffer(tenantId, application.offerId)
        : null;
      await ApplicationNotificationMail.sendApplicationStatusChanged({
        to: application.email,
        applicantName: application.firstName,
        companyName: company ? company.name : null,
        offerTitle: offer ? offer.title : null,
        oldStatus: oldStatusName,
        newStatus: statusName,
      });
    })().catch((error) =>
      AuditLogService.record(
        tenantId,
        "error",
        `Statusbenachrichtigung an die Bewerber*in konnte nicht gesendet werden: ${error?.message || error}`,
      ),
    );

    return { id: applicationId, status };
  }

  static async getApplicationById(tenantId, id) {
    const application = await ApplicationManager.getById(tenantId, id);
    if (!application) {
      throw { message: "Application not found", status: 404 };
    }
    return application;
  }

  static async addDocumentRef(tenantId, applicationId, ref) {
    await ApplicationManager.addDocument(tenantId, applicationId, ref);
    return ref;
  }

  static async removeDocumentRef(tenantId, applicationId, documentId) {
    await ApplicationManager.removeDocument(
      tenantId,
      applicationId,
      documentId,
    );
    return { removed: documentId };
  }

  // remove one application + its document files (rolls back a failed submit)
  static async deleteApplication(tenantId, id) {
    const application = await ApplicationManager.getById(tenantId, id);
    if (!application) {
      return { removed: 0 };
    }
    await ApplicationService._deleteDocumentFiles(tenantId, [application]);
    await ApplicationManager.removeById(tenantId, id);
    return { removed: 1 };
  }

  // remove every application for an offer, including its document files
  static async deleteByOffer(tenantId, offerId) {
    const applications = await ApplicationManager.getByOffer(tenantId, offerId);
    await ApplicationService._deleteDocumentFiles(tenantId, applications);
    await ApplicationManager.removeByOffer(tenantId, offerId);
    return { removed: applications.length };
  }

  // Same, for every application belonging to a company (owner account deletion).
  static async deleteByCompany(tenantId, companyId) {
    const applications = await ApplicationManager.getByCompany(
      tenantId,
      companyId,
    );
    await ApplicationService._deleteDocumentFiles(tenantId, applications);
    await ApplicationManager.removeByCompany(tenantId, companyId);
    return { removed: applications.length };
  }

  // every application by a student across ALL tenants (deletion leaves no PII)
  static async deleteByStudent(studentUserId) {
    const applications =
      await ApplicationManager.getAllByStudent(studentUserId);
    for (const application of applications) {
      await ApplicationService._deleteDocumentFiles(application.tenantId, [
        application,
      ]);
    }
    await ApplicationManager.removeByStudentAllTenants(studentUserId);
    return { removed: applications.length };
  }

  static async _deleteDocumentFiles(tenantId, applications) {
    for (const application of applications) {
      for (const doc of application.documents || []) {
        try {
          await NextcloudManager.deleteFile(tenantId, doc.fileName);
        } catch {
          // best-effort: a missing file must not abort the deletion cascade
        }
      }
    }
  }

  static documentDtos(tenantId, applicationId, documents) {
    return (documents || []).map((doc) =>
      toDocDto(tenantId, applicationId, doc),
    );
  }
}

module.exports = ApplicationService;
