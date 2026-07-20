const { v4: uuidv4 } = require("uuid");
const { isEmail } = require("validator");
const OfferManager = require("../../data-managers/offer-manager");
const OfferMediaManager = require("../../data-managers/offer-media-manager");
const OfferBookmarkManager = require("../../data-managers/offer-bookmark-manager");
const CompanyManager = require("../../data-managers/company-manager");
const CompanyBranchManager = require("../../data-managers/company-branch-manager");
const TaxonomyTermManager = require("../../data-managers/taxonomy-term-manager");
const PlatformSettingsService = require("../platform-settings-service");
const ApplicationService = require("../student/application-service");
const ApplicationManager = require("../../data-managers/application-manager");
const AuditLogService = require("../audit-log-service");

const CONTACT_CHANNELS = [
  "Direktbewerbung über Plattform",
  "Per E-Mail",
  "Per Post",
  "Telefonisch",
  "Persönlich vorbeikommen",
  "Externes Bewerbermanagementsystem",
];
const EXTERNAL_CHANNEL = "Externes Bewerbermanagementsystem";
const MAX_MEDIA_ITEMS = 12;

async function assertTaxonomyRef(tenantId, id, type, label) {
  if (!id) {
    return;
  }
  const term = await TaxonomyTermManager.getTerm(tenantId, id);
  if (!term || term.type !== type || !term.active) {
    throw { message: `Invalid ${label}`, status: 400 };
  }
}

function normalizeContactPersons(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((entry) => {
      const person = entry && typeof entry === "object" ? entry : {};
      return {
        firstName: String(person.firstName || "").trim(),
        lastName: String(person.lastName || "").trim(),
        email: String(person.email || "").trim(),
        phone: String(person.phone || "").trim(),
      };
    })
    .filter((person) => person.firstName || person.lastName || person.email);
}

function getCoordinates(location) {
  return location && Array.isArray(location.coordinates)
    ? location.coordinates
    : null;
}

function toOfferDto(offer) {
  const coordinates = getCoordinates(offer.location);
  return {
    id: offer.id,
    companyId: offer.companyId,
    branchId: offer.branchId,
    title: offer.title,
    industryId: offer.industryId,
    internshipTypeId: offer.internshipTypeId,
    minAge: offer.minAge,
    duration: offer.duration,
    applicationDeadline: offer.applicationDeadline,
    city: offer.city,
    postalCode: offer.postalCode,
    districtId: offer.districtId,
    lat: coordinates ? coordinates[1] : null,
    lng: coordinates ? coordinates[0] : null,
    requirements: offer.requirements,
    additionalInfo: offer.additionalInfo,
    aboutUs: offer.aboutUs,
    externalLink: offer.externalLink,
    contactChannels: offer.contactChannels || [],
    contactPersons: offer.contactPersons || [],
    status: offer.status,
    reviewNote: offer.reviewNote,
    views: offer.views,
    created: offer.created,
    publishedAt: offer.publishedAt,
  };
}

function toPublicOfferDto(offer) {
  const dto = toOfferDto(offer);
  delete dto.reviewNote;
  return dto;
}

function toSearchOfferDto(offer) {
  const dto = toPublicOfferDto(offer);
  delete dto.contactPersons;
  return dto;
}

function toOfferMediaDto(media) {
  return {
    id: media.id,
    offerId: media.offerId,
    url: media.url,
    fileName: media.fileName,
    type: media.type,
    created: media.created,
  };
}

function toPublicOfferMediaDto(media) {
  return {
    id: media.id,
    offerId: media.offerId,
    url: media.url,
    type: media.type,
    created: media.created,
  };
}

async function validateOfferPayload(tenantId, companyId, payload) {
  const title = String(payload.title || "").trim();
  if (!title || title.length > 200) {
    throw { message: "Title is required (max 200)", status: 400 };
  }

  const branchId = String(payload.branchId || "").trim();
  let branch = null;
  if (branchId) {
    branch = await CompanyBranchManager.getBranch(tenantId, branchId);
    if (!branch || branch.companyId !== companyId) {
      throw { message: "Invalid branch", status: 400 };
    }
  }

  const industryId = String(payload.industryId || "").trim();
  const internshipTypeId = String(payload.internshipTypeId || "").trim();
  if (!industryId) {
    throw { message: "Industry is required", status: 400 };
  }
  await assertTaxonomyRef(tenantId, industryId, "industry", "Branche");
  await assertTaxonomyRef(
    tenantId,
    internshipTypeId,
    "internship_type",
    "Praktikumsart",
  );

  const channels = Array.isArray(payload.contactChannels)
    ? payload.contactChannels.filter((channel) =>
        CONTACT_CHANNELS.includes(channel),
      )
    : [];
  if (channels.length === 0) {
    throw {
      message: "At least one contact channel is required",
      status: 400,
    };
  }

  let externalLink = String(payload.externalLink || "").trim();
  if (channels.includes(EXTERNAL_CHANNEL)) {
    if (!externalLink || !/^https:\/\/\S+$/.test(externalLink)) {
      throw {
        message:
          "A valid https:// link is required for the external application system",
        status: 400,
      };
    }
  } else {
    externalLink = "";
  }

  let minAge = null;
  if (
    payload.minAge !== undefined &&
    payload.minAge !== null &&
    payload.minAge !== ""
  ) {
    minAge = Number(payload.minAge);
    if (!Number.isFinite(minAge) || minAge < 0) {
      throw { message: "Invalid minimum age", status: 400 };
    }
  }

  const applicationDeadline = String(payload.applicationDeadline || "").trim();
  if (applicationDeadline && isNaN(Date.parse(applicationDeadline))) {
    throw { message: "Invalid application deadline", status: 400 };
  }

  const contactPersons = normalizeContactPersons(payload.contactPersons);
  for (const person of contactPersons) {
    if (person.email && !isEmail(person.email)) {
      throw { message: "Invalid contact person email", status: 400 };
    }
  }

  return {
    title,
    branch,
    industryId,
    internshipTypeId,
    minAge,
    duration: String(payload.duration || "").trim(),
    applicationDeadline,
    requirements: String(payload.requirements || ""),
    additionalInfo: String(payload.additionalInfo || ""),
    aboutUs: String(payload.aboutUs || ""),
    contactChannels: channels,
    externalLink,
    contactPersons,
  };
}

function requestedStatus(payload) {
  return payload.status === "In Prüfung" ? "In Prüfung" : "Entwurf";
}

class OfferService {
  static async _resolveStatus(tenantId, company, requested) {
    if (requested !== "In Prüfung") {
      return { status: "Entwurf", publishedAt: null };
    }
    const settings = await PlatformSettingsService.getSettings(tenantId);
    if (settings.directPublishVerified && company.status === "verified") {
      return { status: "Online", publishedAt: Date.now() };
    }
    return { status: "In Prüfung", publishedAt: null };
  }

  static async createOffer(tenantId, companyId, payload) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    const fields = await validateOfferPayload(tenantId, companyId, payload);
    const resolved = await OfferService._resolveStatus(
      tenantId,
      company,
      requestedStatus(payload),
    );

    const loc = fields.branch ?? company;
    const offer = await OfferManager.storeOffer({
      id: uuidv4(),
      tenantId,
      companyId,
      branchId: fields.branch ? fields.branch.id : "",
      title: fields.title,
      industryId: fields.industryId,
      internshipTypeId: fields.internshipTypeId,
      minAge: fields.minAge,
      duration: fields.duration,
      applicationDeadline: fields.applicationDeadline,
      city: loc.city,
      postalCode: loc.postalCode,
      districtId: loc.districtId,
      location: loc.location || null,
      requirements: fields.requirements,
      additionalInfo: fields.additionalInfo,
      aboutUs: fields.aboutUs,
      externalLink: fields.externalLink,
      contactChannels: fields.contactChannels,
      contactPersons: fields.contactPersons,
      status: resolved.status,
      reviewNote: "",
      views: 0,
      publishedAt: resolved.publishedAt,
    });
    await AuditLogService.record(
      tenantId,
      "create",
      `Praktikum „${offer.title}" angelegt`,
    );
    return toOfferDto(offer);
  }

  static async updateOffer(tenantId, companyId, offerId, payload) {
    const existing = await OfferManager.getOffer(tenantId, offerId);
    if (!existing || existing.companyId !== companyId) {
      throw { message: "Offer not found", status: 404 };
    }
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    const fields = await validateOfferPayload(tenantId, companyId, payload);

    // a company may only submit a draft or withdraw a pending offer; else no-op
    let status = existing.status;
    let publishedAt = existing.publishedAt;
    let reviewNote = existing.reviewNote;
    if (payload.status !== undefined && payload.status !== existing.status) {
      if (payload.status === "In Prüfung" && existing.status === "Entwurf") {
        const resolved = await OfferService._resolveStatus(
          tenantId,
          company,
          "In Prüfung",
        );
        status = resolved.status;
        publishedAt = status === "Online" ? Date.now() : null;
        reviewNote = "";
      } else if (
        payload.status === "Entwurf" &&
        existing.status === "In Prüfung"
      ) {
        status = "Entwurf";
        publishedAt = null;
      }
    }

    const loc = fields.branch ?? company;
    const offer = await OfferManager.storeOffer({
      ...existing,
      branchId: fields.branch ? fields.branch.id : "",
      title: fields.title,
      industryId: fields.industryId,
      internshipTypeId: fields.internshipTypeId,
      minAge: fields.minAge,
      duration: fields.duration,
      applicationDeadline: fields.applicationDeadline,
      city: loc.city,
      postalCode: loc.postalCode,
      districtId: loc.districtId,
      location: loc.location || null,
      requirements: fields.requirements,
      additionalInfo: fields.additionalInfo,
      aboutUs: fields.aboutUs,
      externalLink: fields.externalLink,
      contactChannels: fields.contactChannels,
      contactPersons: fields.contactPersons,
      status,
      reviewNote,
      publishedAt,
      id: existing.id,
      tenantId: existing.tenantId,
      companyId: existing.companyId,
      created: existing.created,
      views: existing.views,
    });
    if (existing.status === "Entwurf" && offer.status !== "Entwurf") {
      await AuditLogService.record(
        tenantId,
        "update",
        offer.status === "Online"
          ? `Praktikum „${offer.title}" veröffentlicht`
          : `Praktikum „${offer.title}" zur Prüfung eingereicht`,
      );
    }
    return toOfferDto(offer);
  }

  static async getCompanyOffers(tenantId, companyId, branchScope = null) {
    const offers = await OfferManager.getOffersByCompany(tenantId, companyId);
    const scoped =
      branchScope === null || branchScope === undefined
        ? offers
        : offers.filter((o) => (o.branchId || "") === branchScope);
    return scoped.map(toOfferDto);
  }

  static async getCompanyOffer(tenantId, companyId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer || offer.companyId !== companyId) {
      throw { message: "Offer not found", status: 404 };
    }
    return toOfferDto(offer);
  }

  static async getCompanyStats(tenantId, companyId, filters = {}) {
    const all = await OfferManager.getOffersByCompany(tenantId, companyId);
    // undefined = no filter; "" filters to company-level offers (branchId === "")
    const offers = all.filter(
      (o) =>
        (filters.branchId === undefined || o.branchId === filters.branchId) &&
        (filters.industryId === undefined ||
          o.industryId === filters.industryId),
    );

    const byStatus = { Entwurf: 0, "In Prüfung": 0, Online: 0, Archiv: 0 };
    const branches = new Map();
    const industries = new Map();
    const internshipTypes = new Map();
    const districts = new Map();
    let totalViews = 0;

    for (const o of offers) {
      if (byStatus[o.status] !== undefined) {
        byStatus[o.status] += 1;
      }
      totalViews += o.views || 0;
      const branch = branches.get(o.branchId) || { total: 0, online: 0 };
      branch.total += 1;
      if (o.status === "Online") {
        branch.online += 1;
      }
      branches.set(o.branchId, branch);
      if (o.industryId) {
        industries.set(o.industryId, (industries.get(o.industryId) || 0) + 1);
      }
      if (o.internshipTypeId) {
        internshipTypes.set(
          o.internshipTypeId,
          (internshipTypes.get(o.internshipTypeId) || 0) + 1,
        );
      }
      if (o.districtId) {
        districts.set(o.districtId, (districts.get(o.districtId) || 0) + 1);
      }
    }

    const toCounts = (map) =>
      Array.from(map.entries()).map(([id, count]) => ({ id, count }));

    return {
      total: offers.length,
      byStatus,
      totalViews,
      byBranch: Array.from(branches.entries()).map(([branchId, v]) => ({
        branchId,
        total: v.total,
        online: v.online,
      })),
      byIndustry: toCounts(industries),
      byInternshipType: toCounts(internshipTypes),
      byDistrict: toCounts(districts),
    };
  }

  static async deleteOffer(tenantId, companyId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer || offer.companyId !== companyId) {
      throw { message: "Offer not found", status: 404 };
    }
    await ApplicationService.deleteByOffer(tenantId, offerId);
    await OfferBookmarkManager.removeByOffer(tenantId, offerId);
    await OfferMediaManager.removeByOffer(tenantId, offerId);
    await OfferManager.removeOffer(tenantId, offerId);
    await AuditLogService.record(
      tenantId,
      "delete",
      `Praktikum „${offer.title}" gelöscht`,
    );
    return { removed: offerId };
  }

  static async searchPublicOffers(tenantId, filters) {
    const resolved = { ...filters };
    if (filters.company) {
      const companyIds = await CompanyManager.getCompanyIdsByName(
        tenantId,
        filters.company,
      );
      if (companyIds.length === 0) {
        return [];
      }
      resolved.companyIds = companyIds;
    }
    resolved.excludeCompanyIds =
      await CompanyManager.getBlockedCompanyIds(tenantId);
    const offers = await OfferManager.searchOnline(tenantId, resolved);
    return offers.map(toSearchOfferDto);
  }

  static async getPublicOffer(tenantId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer || offer.status !== "Online") {
      throw { message: "Offer not found", status: 404 };
    }
    const company = await CompanyManager.getCompany(tenantId, offer.companyId);
    if (!company || company.status === "blocked") {
      throw { message: "Offer not found", status: 404 };
    }
    await OfferManager.incrementViews(tenantId, offerId);
    const media = await OfferMediaManager.getMediaByOffer(tenantId, offerId);
    return {
      ...toPublicOfferDto({ ...offer, views: offer.views + 1 }),
      media: media.map(toPublicOfferMediaDto),
    };
  }

  static async getPublicOffersByIds(tenantId, ids) {
    const offers = await OfferManager.getOffersByIds(tenantId, ids);
    const blocked = new Set(
      await CompanyManager.getBlockedCompanyIds(tenantId),
    );
    return offers
      .filter(
        (offer) => offer.status === "Online" && !blocked.has(offer.companyId),
      )
      .map(toPublicOfferDto);
  }

  static async listForModeration(tenantId, filters) {
    const result = await OfferManager.listForModeration(tenantId, filters);
    const offers = Array.isArray(result) ? result : result.items;
    const counts = await ApplicationManager.countByOffers(
      tenantId,
      offers.map((o) => o.id),
    );
    const dtos = offers.map((offer) => ({
      ...toOfferDto(offer),
      applicationCount: counts[offer.id] || 0,
    }));
    return Array.isArray(result) ? dtos : { items: dtos, total: result.total };
  }

  static async approveOffer(tenantId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer) {
      throw { message: "Offer not found", status: 404 };
    }
    if (offer.status !== "In Prüfung") {
      throw { message: "Only submitted offers can be approved", status: 409 };
    }
    const updated = await OfferManager.storeOffer({
      ...offer,
      status: "Online",
      publishedAt: offer.publishedAt || Date.now(),
      reviewNote: "",
    });
    await AuditLogService.record(
      tenantId,
      "update",
      `Praktikum „${updated.title}" freigegeben (Online)`,
    );
    return toOfferDto(updated);
  }

  static async rejectOffer(tenantId, offerId, note) {
    const reviewNote = String(note || "").trim();
    if (!reviewNote) {
      throw { message: "A note is required to reject an offer", status: 400 };
    }
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer) {
      throw { message: "Offer not found", status: 404 };
    }
    if (offer.status !== "In Prüfung") {
      throw { message: "Only submitted offers can be rejected", status: 409 };
    }
    const updated = await OfferManager.storeOffer({
      ...offer,
      status: "Entwurf",
      reviewNote,
    });
    await AuditLogService.record(
      tenantId,
      "update",
      `Praktikum „${updated.title}" abgelehnt`,
    );
    return toOfferDto(updated);
  }

  static async deactivateOffer(tenantId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer) {
      throw { message: "Offer not found", status: 404 };
    }
    if (offer.status !== "Online") {
      throw { message: "Only online offers can be deactivated", status: 409 };
    }
    const updated = await OfferManager.storeOffer({
      ...offer,
      status: "Archiv",
    });
    await AuditLogService.record(
      tenantId,
      "update",
      `Praktikum „${updated.title}" archiviert`,
    );
    return toOfferDto(updated);
  }

  static async reactivateOffer(tenantId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer) {
      throw { message: "Offer not found", status: 404 };
    }
    if (offer.status !== "Archiv") {
      throw {
        message: "Only archived offers can be reactivated",
        status: 409,
      };
    }
    const updated = await OfferManager.storeOffer({
      ...offer,
      status: "Online",
      publishedAt: Date.now(),
    });
    await AuditLogService.record(
      tenantId,
      "update",
      `Praktikum „${updated.title}" wieder online gestellt`,
    );
    return toOfferDto(updated);
  }

  // company-side archive (Online → Archiv)
  static async archiveOffer(tenantId, companyId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer || offer.companyId !== companyId) {
      throw { message: "Offer not found", status: 404 };
    }
    if (offer.status !== "Online") {
      throw { message: "Only online offers can be archived", status: 409 };
    }
    const updated = await OfferManager.storeOffer({
      ...offer,
      status: "Archiv",
    });
    await AuditLogService.record(
      tenantId,
      "update",
      `Praktikum „${updated.title}" archiviert`,
    );
    return toOfferDto(updated);
  }

  // company-side reactivate (Archiv → Online)
  static async reactivateCompanyOffer(tenantId, companyId, offerId) {
    const offer = await OfferManager.getOffer(tenantId, offerId);
    if (!offer || offer.companyId !== companyId) {
      throw { message: "Offer not found", status: 404 };
    }
    if (offer.status !== "Archiv") {
      throw { message: "Only archived offers can be reactivated", status: 409 };
    }
    const updated = await OfferManager.storeOffer({
      ...offer,
      status: "Online",
      publishedAt: Date.now(),
    });
    await AuditLogService.record(
      tenantId,
      "update",
      `Praktikum „${updated.title}" wieder online gestellt`,
    );
    return toOfferDto(updated);
  }

  static async listOfferMedia(tenantId, offerId) {
    const media = await OfferMediaManager.getMediaByOffer(tenantId, offerId);
    return media.map(toOfferMediaDto);
  }

  static async addOfferMedia(tenantId, offerId, { url, fileName, type }) {
    const existing = await OfferMediaManager.getMediaByOffer(tenantId, offerId);
    if (existing.length >= MAX_MEDIA_ITEMS) {
      throw {
        message: `An offer can have at most ${MAX_MEDIA_ITEMS} media items`,
        status: 409,
      };
    }
    const media = await OfferMediaManager.storeMedia({
      id: uuidv4(),
      tenantId,
      offerId,
      url,
      fileName,
      type,
    });
    return toOfferMediaDto(media);
  }

  static async removeOfferMedia(tenantId, offerId, mediaId) {
    const media = await OfferMediaManager.getMedia(tenantId, mediaId);
    if (!media || media.offerId !== offerId) {
      throw { message: "Media not found", status: 404 };
    }
    await OfferMediaManager.removeMedia(tenantId, mediaId);
    return toOfferMediaDto(media);
  }
}

module.exports = OfferService;
