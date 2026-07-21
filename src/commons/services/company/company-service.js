const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { User, USER_HOOK_TYPES } = require("../../entities/user/user");
const UserManager = require("../../data-managers/user-manager");
const UserService = require("../user-service");
const MembershipManager = require("../../data-managers/membership-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const CompanyManager = require("../../data-managers/company-manager");
const CompanyMemberManager = require("../../data-managers/company-member-manager");
const CompanyMediaManager = require("../../data-managers/company-media-manager");
const { NextcloudManager } = require("../../data-managers/file-manager");
const { deleteFileByUrl } = require("../../utilities/file-url");
const CompanyBranchManager = require("../../data-managers/company-branch-manager");
const OfferManager = require("../../data-managers/offer-manager");
const OfferMediaManager = require("../../data-managers/offer-media-manager");
const OfferBookmarkManager = require("../../data-managers/offer-bookmark-manager");
const MemberInvitationManager = require("../../data-managers/member-invitation-manager");
const AuditLogService = require("../audit-log-service");
const TaxonomyTermManager = require("../../data-managers/taxonomy-term-manager");
const { CompanyRoleService } = require("./company-role-service");
const ApplicationService = require("../student/application-service");
const AccountDeletionService = require("../account-deletion-service");
const JwtHelper = require("../../utilities/jwt-helper");
const MailController = require("../../mail-service/mail-controller");
const MemberInvitationMail = require("./member-invitation-mail");
const { createResendThrottle } = require("../../utilities/resend-throttle");
const { isEmail, isURL } = require("validator");

const DESCRIPTION_MAX_LENGTH = 2000;
const MAX_MEDIA_ITEMS = 12;
const resendThrottle = createResendThrottle();

async function assertTaxonomyRef(tenantId, id, type, label) {
  if (!id) {
    return;
  }
  const term = await TaxonomyTermManager.getTerm(tenantId, id);
  if (!term || term.type !== type || !term.active) {
    throw { message: `Invalid ${label}`, status: 400 };
  }
}

async function setUserSuspended(userId, suspended) {
  const user = await UserManager.getUserBy({ id: userId }, true);
  if (!user) {
    return;
  }
  user.isSuspended = suspended;
  await UserManager.updateUser(user);
}

async function findBranchOrThrow(tenantId, companyId, branchId) {
  const branch = await CompanyBranchManager.getBranch(tenantId, branchId);
  if (!branch || branch.companyId !== companyId) {
    throw { message: "Branch not found", status: 404 };
  }
  return branch;
}

function buildLocation(lat, lng) {
  const toCoord = (value) => {
    if (typeof value !== "number" && typeof value !== "string") {
      return NaN;
    }
    if (typeof value === "string" && value.trim() === "") {
      return NaN;
    }
    return Number(value);
  };
  const latNum = toCoord(lat);
  const lngNum = toCoord(lng);
  if (
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    latNum < -90 ||
    latNum > 90 ||
    lngNum < -180 ||
    lngNum > 180
  ) {
    throw { message: "Invalid coordinates", status: 400 };
  }
  return { type: "Point", coordinates: [lngNum, latNum] };
}

function normalizeBranch(payload, existing) {
  const base = existing || {};

  const name = String(
    payload.name !== undefined ? payload.name : base.name || "",
  ).trim();
  if (!name || name.length > 200) {
    throw { message: "Branch name is required (max 200)", status: 400 };
  }

  const city = String(
    payload.city !== undefined ? payload.city : base.city || "",
  ).trim();
  if (!city) {
    throw { message: "City is required", status: 400 };
  }

  const postalCode = String(
    payload.postalCode !== undefined
      ? payload.postalCode
      : base.postalCode || "",
  ).trim();
  if (postalCode && !/^\d{5}$/.test(postalCode)) {
    throw { message: "Postal code must be 5 digits", status: 400 };
  }

  const hasLat =
    payload.lat !== undefined && payload.lat !== null && payload.lat !== "";
  const hasLng =
    payload.lng !== undefined && payload.lng !== null && payload.lng !== "";
  let location;
  if (hasLat || hasLng) {
    if (!(hasLat && hasLng)) {
      throw { message: "Both lat and lng are required", status: 400 };
    }
    location = buildLocation(payload.lat, payload.lng);
  } else {
    location = base.location !== undefined ? base.location : null;
  }

  return {
    name,
    street: String(
      payload.street !== undefined ? payload.street : base.street || "",
    ).trim(),
    postalCode,
    city,
    districtId:
      payload.districtId !== undefined
        ? payload.districtId
        : base.districtId || "",
    location,
  };
}

function toBranchDto(branch) {
  const coords =
    branch.location && Array.isArray(branch.location.coordinates)
      ? branch.location.coordinates
      : null;
  return {
    id: branch.id,
    companyId: branch.companyId,
    name: branch.name,
    street: branch.street,
    postalCode: branch.postalCode,
    city: branch.city,
    districtId: branch.districtId,
    lat: coords ? coords[1] : null,
    lng: coords ? coords[0] : null,
    logoUrl: branch.logoUrl,
    created: branch.created,
  };
}

function toMemberInvitationDto(invitation) {
  return {
    userId: invitation.email,
    email: invitation.email,
    firstName: invitation.firstName,
    lastName: invitation.lastName,
    phone: invitation.phone,
    branchId: invitation.branchId || "",
    isOwner: invitation.isOwner === true,
    status: "pending",
  };
}

class CompanyService {
  static async registerCompany(tenantId, payload) {
    const owner = payload.owner || {};
    const companyData = payload.company || {};
    const consents = payload.consents || {};

    const email = String(owner.id || "")
      .trim()
      .toLowerCase();
    const password = String(owner.password || "");
    const firstName = String(owner.firstName || "").trim();
    const lastName = String(owner.lastName || "").trim();
    const name = String(companyData.name || "").trim();
    const street = String(companyData.street || "").trim();
    const postalCode = String(companyData.postalCode || "").trim();
    const city = String(companyData.city || "").trim();
    const phone = String(companyData.phone || "").trim();
    const website = String(companyData.website || "").trim();
    const mail = String(companyData.mail || "").trim();
    const hasLetter = (value) => /[A-Za-zÀ-ÿ]/.test(value);

    if (!isEmail(email)) {
      throw { message: "A valid email address is required", status: 400 };
    }
    if (
      password.length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw {
        message:
          "Password must be at least 8 characters and include a letter and a number",
        status: 400,
      };
    }
    if (
      firstName.length < 2 ||
      !hasLetter(firstName) ||
      lastName.length < 2 ||
      !hasLetter(lastName)
    ) {
      throw {
        message: "A valid first and last name are required",
        status: 400,
      };
    }
    if (name.length < 2 || !hasLetter(name)) {
      throw { message: "A valid company name is required", status: 400 };
    }
    if (street.length < 2 || !hasLetter(street)) {
      throw { message: "A valid street is required", status: 400 };
    }
    if (!/^\d{5}$/.test(postalCode)) {
      throw { message: "Postal code must be 5 digits", status: 400 };
    }
    if (city.length < 2 || !hasLetter(city)) {
      throw { message: "A valid city is required", status: 400 };
    }
    if (phone.replace(/\D/g, "").length < 6) {
      throw { message: "A valid phone number is required", status: 400 };
    }
    if (
      website &&
      !isURL(website, { protocols: ["https"], require_protocol: true })
    ) {
      throw { message: "Website must be a valid https:// URL", status: 400 };
    }
    if (mail && !isEmail(mail)) {
      throw { message: "Invalid contact email", status: 400 };
    }
    if (String(companyData.description || "").length > DESCRIPTION_MAX_LENGTH) {
      throw {
        message: `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
        status: 400,
      };
    }
    const hasLat =
      companyData.lat !== undefined &&
      companyData.lat !== null &&
      companyData.lat !== "";
    const hasLng =
      companyData.lng !== undefined &&
      companyData.lng !== null &&
      companyData.lng !== "";
    let location = null;
    if (hasLat || hasLng) {
      if (!(hasLat && hasLng)) {
        throw { message: "Both lat and lng are required", status: 400 };
      }
      location = buildLocation(companyData.lat, companyData.lng);
    }
    if (
      !consents.privacyConsent ||
      !consents.authorizedToRepresent ||
      !consents.consent
    ) {
      throw { message: "All consents are required", status: 400 };
    }

    const tenant = await TenantManager.getTenant(tenantId);
    if (!tenant) {
      throw { message: "Tenant not found", status: 404 };
    }

    await assertTaxonomyRef(
      tenantId,
      companyData.districtId,
      "district",
      "Kreis",
    );
    await assertTaxonomyRef(
      tenantId,
      companyData.industryId,
      "industry",
      "Branche",
    );
    await assertTaxonomyRef(
      tenantId,
      companyData.sizeId,
      "company_size",
      "Unternehmensgröße",
    );

    const existingUser = await UserManager.getUserBy({ id: email });
    if (existingUser) {
      throw { message: "Email already in use", status: 409 };
    }

    const existingMembership =
      await MembershipManager.getMembershipByTenantAndUserID(tenantId, email);
    if (existingMembership) {
      throw { message: "User already registered in this tenant", status: 409 };
    }

    const user = new User({
      id: email,
      secret: undefined,
      firstName,
      lastName,
      company: name,
    });
    user.setPassword(password);

    let company = null;
    try {
      await UserService.singUpUser(user, payload.nextUrl);
      await MembershipManager.addMembership(tenantId, {
        userId: email,
        source: "public",
        status: "pending",
        owner: false,
      });
      company = await CompanyManager.storeCompany({
        id: uuidv4(),
        tenantId,
        name,
        slug: companyData.slug,
        status: "unverified",
        mail,
        phone,
        website,
        street,
        postalCode,
        city,
        districtId: companyData.districtId,
        industryId: companyData.industryId,
        sizeId: companyData.sizeId,
        description: companyData.description,
        location,
      });
      await CompanyMemberManager.storeMember({
        id: uuidv4(),
        tenantId,
        companyId: company.id,
        userId: email,
        isOwner: true,
      });
    } catch (err) {
      if (company) {
        await CompanyMemberManager.removeMember(
          tenantId,
          company.id,
          email,
        ).catch(() => {});
        await CompanyManager.deleteCompany(tenantId, company.id).catch(
          () => {},
        );
      }
      await MembershipManager.removeMembership(tenantId, email).catch(() => {});
      await UserManager.deleteUser(email).catch(() => {});
      throw err;
    }

    await AuditLogService.record(
      tenantId,
      "create",
      `Unternehmen „${company.name}" registriert`,
    );
    return company;
  }

  static async resendVerification(tenantId, email, nextUrl) {
    const normalized = String(email || "")
      .trim()
      .toLowerCase();
    if (!normalized) {
      throw { message: "Missing email", status: 400 };
    }

    const throttleKey = `${tenantId}:${normalized}`;
    resendThrottle.assertNotThrottled(throttleKey);
    resendThrottle.arm(throttleKey);

    const member = await CompanyMemberManager.getMemberByUser(
      tenantId,
      normalized,
    );
    if (!member) {
      return;
    }

    const user = await UserManager.getUserBy({ id: normalized }, true);
    if (!user || user.isVerified) {
      return;
    }

    const hook = user.addHook(USER_HOOK_TYPES.VERIFY, { nextUrl });
    await UserManager.updateUser(user);

    await MailController.sendVerificationRequest(user.id, hook.id);
  }

  static async verifyCompany(tenantId, companyId) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }

    const role = await CompanyRoleService.ensureUnternehmenRole(tenantId);
    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );

    for (const member of members) {
      await MembershipManager.updateMembership(tenantId, member.userId, {
        status: "active",
      });
      await MembershipManager.addRoleToMembership(
        tenantId,
        member.userId,
        role.id,
      );
      await setUserSuspended(member.userId, false);
    }

    await CompanyManager.setStatus(tenantId, companyId, "verified");
    await AuditLogService.record(
      tenantId,
      "update",
      `Unternehmen „${company.name}" freigegeben`,
    );
    return CompanyManager.getCompany(tenantId, companyId);
  }

  static async blockCompany(tenantId, companyId) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }

    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );
    for (const member of members) {
      await MembershipManager.updateMembership(tenantId, member.userId, {
        status: "suspended",
      });
      await setUserSuspended(member.userId, true);
      await JwtHelper.revokeAllUserTokens(member.userId, "company_blocked");
    }

    await CompanyManager.setStatus(tenantId, companyId, "blocked");
    await AuditLogService.record(
      tenantId,
      "update",
      `Unternehmen „${company.name}" gesperrt`,
    );
    return CompanyManager.getCompany(tenantId, companyId);
  }

  // revert to "unverified": members drop to pending, block-suspension lifted
  static async unverifyCompany(tenantId, companyId) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }

    const role = await CompanyRoleService.ensureUnternehmenRole(tenantId);
    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );
    for (const member of members) {
      await MembershipManager.updateMembership(tenantId, member.userId, {
        status: "pending",
      });
      await MembershipManager.removeRoleFromMembership(
        tenantId,
        member.userId,
        role.id,
      );
      await setUserSuspended(member.userId, false);
    }

    await CompanyManager.setStatus(tenantId, companyId, "unverified");
    await AuditLogService.record(
      tenantId,
      "update",
      `Unternehmen „${company.name}" auf „nicht verifiziert" zurückgesetzt`,
    );
    return CompanyManager.getCompany(tenantId, companyId);
  }

  // admin-authored company: created "verified"; owner joins via invitation
  static async adminCreateCompany(tenantId, payload) {
    const owner = payload.owner || {};
    const companyData = payload.company || {};

    const email = String(owner.id || owner.email || "")
      .trim()
      .toLowerCase();
    const firstName = String(owner.firstName || "").trim();
    const lastName = String(owner.lastName || "").trim();
    const name = String(companyData.name || "").trim();
    const street = String(companyData.street || "").trim();
    const postalCode = String(companyData.postalCode || "").trim();
    const city = String(companyData.city || "").trim();
    const phone = String(companyData.phone || "").trim();
    const website = String(companyData.website || "").trim();
    const mail = String(companyData.mail || "").trim();
    const hasLetter = (value) => /[A-Za-zÀ-ÿ]/.test(value);

    if (!isEmail(email)) {
      throw { message: "A valid owner email address is required", status: 400 };
    }
    if (
      firstName.length < 2 ||
      !hasLetter(firstName) ||
      lastName.length < 2 ||
      !hasLetter(lastName)
    ) {
      throw {
        message: "A valid first and last name are required",
        status: 400,
      };
    }
    if (name.length < 2 || !hasLetter(name)) {
      throw { message: "A valid company name is required", status: 400 };
    }
    if (street.length < 2 || !hasLetter(street)) {
      throw { message: "A valid street is required", status: 400 };
    }
    if (!/^\d{5}$/.test(postalCode)) {
      throw { message: "Postal code must be 5 digits", status: 400 };
    }
    if (city.length < 2 || !hasLetter(city)) {
      throw { message: "A valid city is required", status: 400 };
    }
    if (phone.replace(/\D/g, "").length < 6) {
      throw { message: "A valid phone number is required", status: 400 };
    }
    if (
      website &&
      !isURL(website, { protocols: ["https"], require_protocol: true })
    ) {
      throw { message: "Website must be a valid https:// URL", status: 400 };
    }
    if (mail && !isEmail(mail)) {
      throw { message: "Invalid contact email", status: 400 };
    }
    if (String(companyData.description || "").length > DESCRIPTION_MAX_LENGTH) {
      throw {
        message: `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
        status: 400,
      };
    }
    const hasLat =
      companyData.lat !== undefined &&
      companyData.lat !== null &&
      companyData.lat !== "";
    const hasLng =
      companyData.lng !== undefined &&
      companyData.lng !== null &&
      companyData.lng !== "";
    let location = null;
    if (hasLat || hasLng) {
      if (!(hasLat && hasLng)) {
        throw { message: "Both lat and lng are required", status: 400 };
      }
      location = buildLocation(companyData.lat, companyData.lng);
    }

    const tenant = await TenantManager.getTenant(tenantId);
    if (!tenant) {
      throw { message: "Tenant not found", status: 404 };
    }

    await assertTaxonomyRef(
      tenantId,
      companyData.districtId,
      "district",
      "Kreis",
    );
    await assertTaxonomyRef(
      tenantId,
      companyData.industryId,
      "industry",
      "Branche",
    );
    await assertTaxonomyRef(
      tenantId,
      companyData.sizeId,
      "company_size",
      "Unternehmensgröße",
    );

    const existingUser = await UserManager.getUserBy({ id: email });
    if (existingUser) {
      throw { message: "Email already in use", status: 409 };
    }
    const existingMembership =
      await MembershipManager.getMembershipByTenantAndUserID(tenantId, email);
    if (existingMembership) {
      throw { message: "User already registered in this tenant", status: 409 };
    }
    const pendingInvitation =
      await MemberInvitationManager.getPendingByEmailInTenant(tenantId, email);
    if (pendingInvitation) {
      throw {
        message: "An invitation for this email is already pending",
        status: 409,
      };
    }

    const company = await CompanyManager.storeCompany({
      id: uuidv4(),
      tenantId,
      name,
      slug: companyData.slug,
      status: "verified",
      mail,
      phone,
      website,
      street,
      postalCode,
      city,
      districtId: companyData.districtId,
      industryId: companyData.industryId,
      sizeId: companyData.sizeId,
      description: companyData.description,
      location,
    });

    let invitation;
    try {
      const token = crypto.randomBytes(32).toString("hex");
      invitation = await MemberInvitationManager.store({
        id: uuidv4(),
        tenantId,
        companyId: company.id,
        token,
        email,
        firstName,
        lastName,
        phone,
        branchId: "",
        isOwner: true,
        status: "pending",
        invitedBy: "admin",
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      try {
        await MemberInvitationMail.sendMemberInvitation({
          sendTo: email,
          companyName: company.name,
          token,
        });
      } catch {
        // mail is best-effort; the invitation can be re-sent or accepted via its link
      }
    } catch (err) {
      await CompanyManager.deleteCompany(tenantId, company.id).catch(() => {});
      throw err;
    }

    await AuditLogService.record(
      tenantId,
      "create",
      `Unternehmen „${company.name}" durch Admin angelegt`,
    );
    return { company, invitation: toMemberInvitationDto(invitation) };
  }

  // admin force-delete: purge every dependent record (no 409 guard, no cascade)
  static async adminDeleteCompany(tenantId, companyId) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }

    const offers = await OfferManager.getOffersByCompany(tenantId, companyId);
    for (const offer of offers) {
      const offerMedia = await OfferMediaManager.getMediaByOffer(
        tenantId,
        offer.id,
      );
      for (const item of offerMedia) {
        await deleteFileByUrl(tenantId, item.url);
      }
      await OfferMediaManager.removeByOffer(tenantId, offer.id);
      await OfferBookmarkManager.removeByOffer(tenantId, offer.id);
      await OfferManager.removeOffer(tenantId, offer.id);
    }
    await ApplicationService.deleteByCompany(tenantId, companyId);

    const branches = await CompanyBranchManager.getBranchesByCompany(
      tenantId,
      companyId,
    );
    for (const branch of branches) {
      await deleteFileByUrl(tenantId, branch.logoUrl);
      await CompanyBranchManager.removeBranch(tenantId, branch.id);
    }

    const invitations = await MemberInvitationManager.getPendingByCompany(
      tenantId,
      companyId,
    );
    for (const invitation of invitations) {
      await MemberInvitationManager.remove(tenantId, invitation.id);
    }

    const media = await CompanyMediaManager.getMediaByCompany(
      tenantId,
      companyId,
    );
    for (const item of media) {
      if (item.fileName) {
        await NextcloudManager.deleteFile(tenantId, item.fileName).catch(
          () => {},
        );
      }
      await CompanyMediaManager.removeMedia(tenantId, item.id);
    }
    await deleteFileByUrl(tenantId, company.logoUrl);

    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );
    for (const member of members) {
      await JwtHelper.revokeAllUserTokens(member.userId, "company_deleted");
      await MembershipManager.removeMembership(tenantId, member.userId);
      await CompanyMemberManager.removeMember(
        tenantId,
        companyId,
        member.userId,
      );
      const remaining = await MembershipManager.getMembershipsByUserID(
        member.userId,
      );
      if (!remaining || remaining.length === 0) {
        await UserManager.deleteUser(member.userId);
      }
    }

    await CompanyManager.deleteCompany(tenantId, companyId);
    await AuditLogService.record(
      tenantId,
      "delete",
      `Unternehmen „${company.name}" durch Admin gelöscht`,
    );
    return { deleted: companyId };
  }

  static async updateCompanyProfile(tenantId, companyId, payload) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }

    const name = String(payload.name || "").trim();
    if (!name || name.length > 200) {
      throw { message: "Company name is required (max 200)", status: 400 };
    }
    const website =
      payload.website !== undefined
        ? String(payload.website).trim()
        : undefined;
    if (website && !/^https:\/\/\S+$/.test(website)) {
      throw { message: "Website must be a valid https:// URL", status: 400 };
    }
    if (payload.mail && !isEmail(String(payload.mail))) {
      throw { message: "Invalid contact email", status: 400 };
    }
    await assertTaxonomyRef(tenantId, payload.districtId, "district", "Kreis");
    await assertTaxonomyRef(
      tenantId,
      payload.industryId,
      "industry",
      "Branche",
    );
    await assertTaxonomyRef(
      tenantId,
      payload.sizeId,
      "company_size",
      "Unternehmensgröße",
    );

    const hasLat =
      payload.lat !== undefined && payload.lat !== null && payload.lat !== "";
    const hasLng =
      payload.lng !== undefined && payload.lng !== null && payload.lng !== "";
    let location;
    if (hasLat || hasLng) {
      if (!(hasLat && hasLng)) {
        throw { message: "Both lat and lng are required", status: 400 };
      }
      location = buildLocation(payload.lat, payload.lng);
    } else {
      location = company.location !== undefined ? company.location : null;
    }

    if (
      payload.description !== undefined &&
      String(payload.description).length > DESCRIPTION_MAX_LENGTH
    ) {
      throw {
        message: `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
        status: 400,
      };
    }

    const pick = (key) =>
      payload[key] !== undefined ? payload[key] : company[key];

    const updated = {
      ...company,
      name,
      slug: pick("slug"),
      mail: pick("mail"),
      phone: pick("phone"),
      website: website !== undefined ? website : company.website,
      street: pick("street"),
      postalCode: pick("postalCode"),
      city: pick("city"),
      districtId: pick("districtId"),
      industryId: pick("industryId"),
      sizeId: pick("sizeId"),
      description:
        payload.description !== undefined
          ? String(payload.description)
          : company.description,
      acceptsUnsolicitedApplications:
        pick("acceptsUnsolicitedApplications") === true,
      location,
    };

    await CompanyManager.storeCompany(updated);
    await AuditLogService.record(
      tenantId,
      "update",
      `Unternehmen „${updated.name}" bearbeitet`,
    );
    return CompanyManager.getCompany(tenantId, companyId);
  }

  static async setCompanyLogo(tenantId, companyId, logoUrl) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    await CompanyManager.setLogo(tenantId, companyId, logoUrl);
    return CompanyManager.getCompany(tenantId, companyId);
  }

  static async removeCompanyLogo(tenantId, companyId) {
    return CompanyService.setCompanyLogo(tenantId, companyId, "");
  }

  static async getCompanyMedia(tenantId, companyId) {
    return CompanyMediaManager.getMediaByCompany(tenantId, companyId);
  }

  static async addCompanyMedia(tenantId, companyId, media) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    const existing = await CompanyMediaManager.getMediaByCompany(
      tenantId,
      companyId,
    );
    if (existing.length >= MAX_MEDIA_ITEMS) {
      throw {
        message: `A company can have at most ${MAX_MEDIA_ITEMS} media items`,
        status: 409,
      };
    }
    return CompanyMediaManager.storeMedia({
      id: uuidv4(),
      tenantId,
      companyId,
      url: media.url,
      fileName: media.fileName,
      type: media.type,
    });
  }

  static async removeCompanyMedia(tenantId, companyId, mediaId) {
    const media = await CompanyMediaManager.getMedia(tenantId, mediaId);
    if (!media || media.companyId !== companyId) {
      throw { message: "Media not found", status: 404 };
    }
    await CompanyMediaManager.removeMedia(tenantId, mediaId);
    return media;
  }

  static async getCompanyBranches(tenantId, companyId) {
    const branches = await CompanyBranchManager.getBranchesByCompany(
      tenantId,
      companyId,
    );
    return branches.map(toBranchDto);
  }

  static async getCompanyBranch(tenantId, companyId, branchId) {
    return toBranchDto(await findBranchOrThrow(tenantId, companyId, branchId));
  }

  static async createCompanyBranch(tenantId, companyId, payload) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    const fields = normalizeBranch(payload);
    await assertTaxonomyRef(tenantId, fields.districtId, "district", "Kreis");
    const branch = await CompanyBranchManager.storeBranch({
      id: uuidv4(),
      tenantId,
      companyId,
      ...fields,
    });
    await AuditLogService.record(
      tenantId,
      "create",
      `Zweigstelle „${branch.name}" bei „${company.name}" angelegt`,
    );
    return toBranchDto(branch);
  }

  static async updateCompanyBranch(tenantId, companyId, branchId, payload) {
    const branch = await findBranchOrThrow(tenantId, companyId, branchId);
    const fields = normalizeBranch(payload, branch);
    await assertTaxonomyRef(tenantId, payload.districtId, "district", "Kreis");
    const updated = await CompanyBranchManager.storeBranch({
      ...branch,
      ...fields,
      id: branch.id,
      tenantId: branch.tenantId,
      companyId: branch.companyId,
      logoUrl: branch.logoUrl,
      created: branch.created,
    });
    await AuditLogService.record(
      tenantId,
      "update",
      `Zweigstelle „${updated.name}" bearbeitet`,
    );
    return toBranchDto(updated);
  }

  static async removeCompanyBranch(tenantId, companyId, branchId) {
    const branch = await findBranchOrThrow(tenantId, companyId, branchId);
    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );
    if (members.some((member) => member.branchId === branchId)) {
      throw {
        message:
          "Branch still has members assigned; reassign or remove them first",
        status: 409,
      };
    }
    const pendingInvitations =
      await MemberInvitationManager.getPendingByCompany(tenantId, companyId);
    if (
      pendingInvitations.some((invitation) => invitation.branchId === branchId)
    ) {
      throw {
        message:
          "Branch still has a pending invitation assigned; cancel it before deleting the branch",
        status: 409,
      };
    }
    const offerCount = await OfferManager.countByBranch(
      tenantId,
      companyId,
      branchId,
    );
    if (offerCount > 0) {
      throw {
        message:
          "Branch still has internships assigned; reassign or remove them first",
        status: 409,
      };
    }
    await CompanyBranchManager.removeBranch(tenantId, branchId);
    await AuditLogService.record(
      tenantId,
      "delete",
      `Zweigstelle „${branch.name}" gelöscht`,
    );
    return branch;
  }

  static async setBranchLogo(tenantId, companyId, branchId, logoUrl) {
    const branch = await findBranchOrThrow(tenantId, companyId, branchId);
    await CompanyBranchManager.storeBranch({ ...branch, logoUrl });
    return toBranchDto({ ...branch, logoUrl });
  }

  static async removeBranchLogo(tenantId, companyId, branchId) {
    return CompanyService.setBranchLogo(tenantId, companyId, branchId, "");
  }

  static async inviteMember(tenantId, companyId, invitedBy, payload) {
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    if (company.status === "blocked") {
      throw { message: "This company is blocked", status: 403 };
    }
    const email = String(payload.email || "")
      .trim()
      .toLowerCase();
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    if (!email || !firstName || !lastName) {
      throw {
        message: "First name, last name and email are required",
        status: 400,
      };
    }
    if (!isEmail(email)) {
      throw { message: "Invalid email", status: 400 };
    }
    const branchId = payload.branchId || "";
    if (branchId) {
      const branch = await CompanyBranchManager.getBranch(tenantId, branchId);
      if (!branch || branch.companyId !== companyId) {
        throw { message: "Invalid branch", status: 400 };
      }
    }
    const existingMember = await CompanyMemberManager.getMemberByUser(
      tenantId,
      email,
    );
    if (existingMember) {
      throw { message: "This user already belongs to a company", status: 409 };
    }
    const existingUser = await UserManager.getUserBy({ id: email });
    if (existingUser) {
      throw { message: "This email is already registered", status: 409 };
    }
    const pending = await MemberInvitationManager.getPendingByEmailInTenant(
      tenantId,
      email,
    );
    if (pending) {
      throw {
        message: "An invitation for this email is already pending",
        status: 409,
      };
    }

    const token = crypto.randomBytes(32).toString("hex");
    const invitation = await MemberInvitationManager.store({
      id: uuidv4(),
      tenantId,
      companyId,
      token,
      email,
      firstName,
      lastName,
      phone: String(payload.phone || "").trim(),
      branchId,
      status: "pending",
      invitedBy,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    try {
      await MemberInvitationMail.sendMemberInvitation({
        sendTo: email,
        companyName: company.name,
        token,
      });
    } catch {
      // mail is best-effort; the pending invitation can be re-sent or accepted via its link
    }

    await AuditLogService.record(
      tenantId,
      "create",
      `${email} zu „${company.name}" eingeladen`,
    );
    return toMemberInvitationDto(invitation);
  }

  static async listCompanyMembers(tenantId, companyId) {
    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );
    const active = [];
    for (const member of members) {
      const user = await UserManager.getUserBy({ id: member.userId });
      active.push({
        userId: member.userId,
        email: member.userId,
        firstName: user ? user.firstName : "",
        lastName: user ? user.lastName : "",
        phone: user ? user.phone : "",
        branchId: member.branchId || "",
        isOwner: member.isOwner === true,
        status: "active",
      });
    }
    const invitations = await MemberInvitationManager.getPendingByCompany(
      tenantId,
      companyId,
    );
    return [...active, ...invitations.map(toMemberInvitationDto)];
  }

  static async removeCompanyMember(
    tenantId,
    companyId,
    targetUserId,
    scopeBranchId = null,
  ) {
    const userId = String(targetUserId || "")
      .trim()
      .toLowerCase();
    const outOfScope = (branchId) =>
      scopeBranchId !== null && (branchId || "") !== scopeBranchId;
    const member = await CompanyMemberManager.getMemberByUser(tenantId, userId);
    if (member && member.companyId === companyId) {
      if (member.isOwner === true) {
        throw { message: "The company owner cannot be removed", status: 403 };
      }
      if (outOfScope(member.branchId)) {
        throw {
          message: "You can only manage members in your own branch",
          status: 403,
        };
      }
      await CompanyMemberManager.removeMember(tenantId, companyId, userId);
      await MembershipManager.removeMembership(tenantId, userId);
      const remaining = await MembershipManager.getMembershipsByUserID(userId);
      if (!remaining || remaining.length === 0) {
        await UserManager.deleteUser(userId);
      }
      await AuditLogService.record(
        tenantId,
        "delete",
        `Mitglied ${userId} entfernt`,
      );
      return { removed: userId };
    }
    const pending = await MemberInvitationManager.getPendingByEmail(
      tenantId,
      companyId,
      userId,
    );
    if (pending) {
      if (outOfScope(pending.branchId)) {
        throw {
          message: "You can only manage members in your own branch",
          status: 403,
        };
      }
      await MemberInvitationManager.remove(tenantId, pending.id);
      await AuditLogService.record(
        tenantId,
        "delete",
        `Einladung an ${userId} zurückgezogen`,
      );
      return { removed: userId };
    }
    throw { message: "Member not found", status: 404 };
  }

  static async deleteOwnerAccount(tenantId, companyId, callerUserId, reason) {
    const userId = String(callerUserId || "")
      .trim()
      .toLowerCase();
    const company = await CompanyManager.getCompany(tenantId, companyId);
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    const caller = await CompanyMemberManager.getMemberByUser(tenantId, userId);
    if (!caller || caller.companyId !== companyId || caller.isOwner !== true) {
      throw {
        message: "Only the company owner can delete the account",
        status: 403,
      };
    }
    const reasonId = await AccountDeletionService.assertValidReason(
      tenantId,
      "company",
      reason,
    );

    // owner self-delete: requires an emptied company (members/branches/offers gone)
    const members = await CompanyMemberManager.getMembersByCompany(
      tenantId,
      companyId,
    );
    const invitations = await MemberInvitationManager.getPendingByCompany(
      tenantId,
      companyId,
    );
    const branches = await CompanyBranchManager.getBranchesByCompany(
      tenantId,
      companyId,
    );
    const offers = await OfferManager.getOffersByCompany(tenantId, companyId);
    const memberCount =
      members.filter((m) => m.isOwner !== true).length + invitations.length;
    const branchCount = branches.length;
    const offerCount = offers.length;
    if (memberCount > 0 || branchCount > 0 || offerCount > 0) {
      throw {
        message:
          "Please remove your team members, branches and internships before deleting the account",
        status: 409,
        memberCount,
        branchCount,
        offerCount,
      };
    }

    const media = await CompanyMediaManager.getMediaByCompany(
      tenantId,
      companyId,
    );
    for (const item of media) {
      if (item.fileName) {
        await NextcloudManager.deleteFile(tenantId, item.fileName).catch(
          () => {},
        );
      }
      await CompanyMediaManager.removeMedia(tenantId, item.id);
    }
    await deleteFileByUrl(tenantId, company.logoUrl);

    await ApplicationService.deleteByCompany(tenantId, companyId);
    await CompanyManager.deleteCompany(tenantId, companyId);
    await CompanyMemberManager.removeMember(tenantId, companyId, userId);
    // Count only once the company is actually gone, so a retry cannot double-count.
    await AccountDeletionService.increment(tenantId, "company", reasonId);
    await MembershipManager.removeMembership(tenantId, userId);
    await JwtHelper.revokeAllUserTokens(userId, "account_deleted");
    const remaining = await MembershipManager.getMembershipsByUserID(userId);
    if (!remaining || remaining.length === 0) {
      await UserManager.deleteUser(userId);
    }
    await AuditLogService.record(
      tenantId,
      "delete",
      `Unternehmen „${company.name}" durch Inhaber gelöscht`,
    );
    return { deleted: userId };
  }

  static async acceptMemberInvitation(tenantId, token, password) {
    const invitation = await MemberInvitationManager.getByToken(token);
    if (
      !invitation ||
      invitation.tenantId !== tenantId ||
      invitation.status !== "pending"
    ) {
      throw { message: "Invalid or expired invitation", status: 404 };
    }
    if (invitation.expiresAt && invitation.expiresAt < Date.now()) {
      throw { message: "This invitation has expired", status: 410 };
    }
    if (
      !password ||
      String(password).length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw {
        message:
          "Password must be at least 8 characters and include a letter and a number",
        status: 400,
      };
    }
    const email = invitation.email;
    const company = await CompanyManager.getCompany(
      tenantId,
      invitation.companyId,
    );
    if (!company) {
      throw { message: "Company not found", status: 404 };
    }
    if (company.status === "blocked") {
      throw { message: "This company is blocked", status: 403 };
    }
    // only a verified company grants active access; else the member stays pending
    const activate = company.status === "verified";

    const alreadyMember = await CompanyMemberManager.getMemberByUser(
      tenantId,
      email,
    );
    if (alreadyMember) {
      throw { message: "This user already belongs to a company", status: 409 };
    }

    const existingUser = await UserManager.getUserBy({ id: email }, true);
    if (existingUser) {
      throw { message: "This email is already registered", status: 409 };
    }
    const user = new User({
      id: email,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      phone: invitation.phone,
      company: company.name,
    });
    user.setPassword(password);
    user.isVerified = true;
    await UserManager.createUser(user);

    try {
      const role = await CompanyRoleService.ensureUnternehmenRole(tenantId);
      const membership = await MembershipManager.getMembershipByTenantAndUserID(
        tenantId,
        email,
      );
      const membershipStatus = activate ? "active" : "pending";
      if (!membership) {
        await MembershipManager.addMembership(tenantId, {
          userId: email,
          source: "invite",
          status: membershipStatus,
          owner: false,
        });
      } else {
        await MembershipManager.updateMembership(tenantId, email, {
          status: membershipStatus,
        });
      }
      if (activate) {
        await MembershipManager.addRoleToMembership(tenantId, email, role.id);
      }

      let branchId = invitation.branchId || "";
      if (branchId) {
        const branch = await CompanyBranchManager.getBranch(tenantId, branchId);
        if (!branch || branch.companyId !== invitation.companyId) {
          branchId = "";
        }
      }

      await CompanyMemberManager.storeMember({
        id: uuidv4(),
        tenantId,
        companyId: invitation.companyId,
        userId: email,
        isOwner: invitation.isOwner === true,
        branchId,
      });

      await MemberInvitationManager.remove(tenantId, invitation.id);
    } catch (err) {
      // undo the user creation so a retry is not blocked by the existing-user guard
      await CompanyMemberManager.removeMember(
        tenantId,
        invitation.companyId,
        email,
      ).catch(() => {});
      await MembershipManager.removeMembership(tenantId, email).catch(() => {});
      await UserManager.deleteUser(email).catch(() => {});
      throw err;
    }
    await AuditLogService.record(
      tenantId,
      "update",
      `Einladung von ${email} zu „${company.name}" angenommen`,
    );
    return { companyId: invitation.companyId, userId: email };
  }
}

module.exports = CompanyService;
