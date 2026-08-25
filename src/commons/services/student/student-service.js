const bunyan = require("bunyan");
const { User, USER_HOOK_TYPES } = require("../../entities/user/user");
const UserManager = require("../../data-managers/user-manager");
const UserService = require("../user-service");
const TenantManager = require("../../data-managers/tenant-manager");
const StudentManager = require("../../data-managers/student-manager");
const OfferBookmarkManager = require("../../data-managers/offer-bookmark-manager");
const ApplicationManager = require("../../data-managers/application-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const JwtHelper = require("../../utilities/jwt-helper");
const AccountDeletionService = require("../account-deletion-service");
const ApplicationService = require("./application-service");
const AuditLogService = require("../audit-log-service");
const { isEmail } = require("validator");
const { createResendThrottle } = require("../../utilities/resend-throttle");
const GuardianConsentService = require("./guardian-consent-service");
const { sendGuardianConsentRequest } = require("./guardian-consent-mail");

const logger = bunyan.createLogger({
  name: "student-service.js",
  level: process.env.LOG_LEVEL,
});

const TARGET_GROUPS = ["pupil", "student", "career_changer"];
const resendThrottle = createResendThrottle();

function isValidBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getTime() <= Date.now()
  );
}

function toProfileDto(user, student) {
  return {
    email: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    street: user.address,
    postalCode: user.zipCode,
    city: user.city,
    phone: user.phone,
    birthDate: student ? student.birthDate : "",
    school: student ? student.school : "",
    grade: student ? student.grade : "",
    targetGroups: student ? student.targetGroups : [],
  };
}

// admin DTO: profile + user meta (verified/blocked/created) + application count
function toAdminDto(user, student, applicationCount, includeConsents) {
  const dto = {
    ...toProfileDto(user, student),
    isVerified: !!user.isVerified,
    isSuspended: !!user.isSuspended,
    createdAt: user.created,
    tenantId: student ? student.tenantId : "",
    applicationCount: applicationCount || 0,
    guardianEmail: student ? student.guardianEmail || "" : "",
    guardianConsentRequired: GuardianConsentService.isPending(student),
    guardianConsentAt: student ? student.guardianConsentAt || null : null,
    guardianConsentBy: student ? student.guardianConsentBy || "" : "",
  };
  if (includeConsents) {
    dto.legalAcceptance = user.legalAcceptance || null;
  }
  return dto;
}

async function setSuspended(userId, suspended) {
  const user = await UserManager.getUserBy({ id: userId }, true);
  if (!user) {
    return;
  }
  user.isSuspended = suspended;
  await UserManager.updateUser(user);
}

class StudentService {
  static async registerStudent(tenantId, payload) {
    const data = payload || {};
    const consents = data.consents || {};

    const email = String(data.email || "")
      .trim()
      .toLowerCase();
    const password = String(data.password || "");
    const firstName = String(data.firstName || "").trim();
    const lastName = String(data.lastName || "").trim();
    const street = String(data.street || "").trim();
    const postalCode = String(data.postalCode || "").trim();
    const city = String(data.city || "").trim();
    const phone = String(data.phone || "").trim();
    const school = String(data.school || "").trim();
    const grade = String(data.grade || "").trim();
    const birthDate = String(data.birthDate || "").trim();
    const guardianEmail = String(data.guardianEmail || "").trim();
    const targetGroups = Array.isArray(data.targetGroups)
      ? data.targetGroups.map((t) => String(t).trim()).filter(Boolean)
      : [];
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
    if (!isValidBirthDate(birthDate)) {
      throw { message: "A valid birth date is required", status: 400 };
    }
    if (
      targetGroups.length === 0 ||
      !targetGroups.every((t) => TARGET_GROUPS.includes(t))
    ) {
      throw {
        message: "At least one valid target group is required",
        status: 400,
      };
    }
    if (!consents.privacyConsent || !consents.consent) {
      throw { message: "All consents are required", status: 400 };
    }

    const guardian = GuardianConsentService.buildForRegistration(
      birthDate,
      guardianEmail,
      email,
    );

    const tenant = await TenantManager.getTenant(tenantId);
    if (!tenant) {
      throw { message: "Tenant not found", status: 404 };
    }

    const existingUser = await UserManager.getUserBy({ id: email });
    if (existingUser) {
      throw { message: "Email already in use", status: 409 };
    }

    const user = new User({
      id: email,
      firstName,
      lastName,
      phone,
      address: street,
      zipCode: postalCode,
      city,
    });
    user.setPassword(password);
    try {
      await UserService.singUpUser(user, data.nextUrl);
      await StudentManager.storeStudent({
        userId: email,
        tenantId,
        birthDate,
        school,
        grade,
        targetGroups,
        ...guardian.fields,
      });
    } catch (err) {
      await StudentManager.removeStudent(email).catch(() => {});
      await UserManager.deleteUser(email).catch(() => {});
      throw err;
    }

    if (guardian.token) {
      try {
        await sendGuardianConsentRequest({
          sendTo: guardian.fields.guardianEmail,
          firstName,
          lastName,
          token: guardian.token,
        });
      } catch (err) {
        logger.warn(
          `Could not send guardian consent request for ${email}: ${err.message || err}`,
        );
      }
    }

    await AuditLogService.record(
      tenantId,
      "create",
      `Schüler*in ${email} registriert`,
    );
    return { id: user.id };
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

    const student = await StudentManager.getStudentByUser(normalized);
    if (!student) {
      return;
    }

    const user = await UserManager.getUserBy({ id: normalized }, true);
    if (!user || user.isVerified) {
      return;
    }

    const hook = user.addHook(USER_HOOK_TYPES.VERIFY, { nextUrl });
    await UserManager.updateUser(user);

    const MailController = require("../../mail-service/mail-controller");
    await MailController.sendVerificationRequest(user.id, hook.id);
  }

  static async getStudentProfile(userId) {
    const user = await UserManager.getUserBy({ id: userId }, false);
    if (!user) {
      throw { message: "User not found", status: 404 };
    }
    const student = await StudentManager.getStudentByUser(userId);
    return toProfileDto(user, student);
  }

  static async updateStudentProfile(userId, payload) {
    const data = payload || {};
    const firstName = String(data.firstName || "").trim();
    const lastName = String(data.lastName || "").trim();
    const street = String(data.street || "").trim();
    const postalCode = String(data.postalCode || "").trim();
    const city = String(data.city || "").trim();
    const phone = String(data.phone || "").trim();
    const school = String(data.school || "").trim();
    const grade = String(data.grade || "").trim();
    const birthDate = String(data.birthDate || "").trim();
    const guardianEmail = String(data.guardianEmail || "").trim();
    const targetGroups = Array.isArray(data.targetGroups)
      ? data.targetGroups.map((t) => String(t).trim()).filter(Boolean)
      : [];
    const hasLetter = (value) => /[A-Za-zÀ-ÿ]/.test(value);

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
    if (!isValidBirthDate(birthDate)) {
      throw { message: "A valid birth date is required", status: 400 };
    }
    if (
      targetGroups.length === 0 ||
      !targetGroups.every((t) => TARGET_GROUPS.includes(t))
    ) {
      throw {
        message: "At least one valid target group is required",
        status: 400,
      };
    }

    const user = await UserManager.getUserBy({ id: userId }, true);
    if (!user) {
      throw { message: "User not found", status: 404 };
    }
    const existing = await StudentManager.getStudentByUser(userId);
    if (!existing) {
      throw { message: "Student profile not found", status: 404 };
    }
    const guardian = {
      guardianEmail: existing.guardianEmail,
      guardianConsentRequiredUntil: existing.guardianConsentRequiredUntil,
      guardianConsentAt: existing.guardianConsentAt,
      guardianConsentBy: existing.guardianConsentBy,
      guardianConsentTokenHash: existing.guardianConsentTokenHash,
      guardianConsentSentAt: existing.guardianConsentSentAt,
    };
    let enrolment = null;

    if (GuardianConsentService.isRequiredFor(birthDate)) {
      const consented = !!existing.guardianConsentAt;
      if (consented || GuardianConsentService.isPending(existing)) {
        guardian.guardianConsentRequiredUntil =
          GuardianConsentService.requiredUntilFor(birthDate);
      } else {
        enrolment = GuardianConsentService.buildForRegistration(
          birthDate,
          guardianEmail || existing.guardianEmail,
          userId,
        );
        Object.assign(guardian, enrolment.fields);
      }
    }
    user.firstName = firstName;
    user.lastName = lastName;
    user.phone = phone;
    user.address = street;
    user.zipCode = postalCode;
    user.city = city;
    await UserManager.updateUser(user);

    await StudentManager.storeStudent({
      userId,
      tenantId: existing.tenantId,
      birthDate,
      targetGroups,
      school,
      grade,
      created: existing.created,
      ...guardian,
    });

    if (enrolment && enrolment.token) {
      try {
        await sendGuardianConsentRequest({
          sendTo: guardian.guardianEmail,
          firstName,
          lastName,
          token: enrolment.token,
        });
      } catch (err) {
        logger.warn(
          `Could not send guardian consent request for ${userId}: ${err.message || err}`,
        );
      }
    }

    return StudentService.getStudentProfile(userId);
  }

  static async deleteAccount(tenantId, userId, reason) {
    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }
    const reasonId = await AccountDeletionService.assertValidReason(
      tenantId,
      "student",
      reason,
    );
    await OfferBookmarkManager.removeByUser(userId);
    await ApplicationService.deleteByStudent(userId);
    await StudentManager.removeStudent(userId);
    // count only after removal, so a retry hits the 404 guard (no double-count)
    await AccountDeletionService.increment(tenantId, "student", reasonId);
    await MembershipManager.removeMembership(tenantId, userId);
    await JwtHelper.revokeAllUserTokens(userId, "account_deleted");
    const remaining = await MembershipManager.getMembershipsByUserID(userId);
    if (!remaining || remaining.length === 0) {
      await UserManager.deleteUser(userId);
    }
    await AuditLogService.record(
      tenantId,
      "delete",
      `Schüler*in ${userId} hat das Konto gelöscht`,
    );
    return { deleted: userId };
  }

  // admin methods guard on the student's tenantId (one region per admin)

  static async adminListStudents(tenantId) {
    const students = await StudentManager.listStudents(tenantId);
    if (students.length === 0) {
      return [];
    }
    const userIds = students.map((s) => s.userId);
    const users = await UserManager.getUsersById(userIds, false);
    const userById = new Map(users.map((u) => [u.id, u]));
    const counts = await ApplicationManager.countByStudents(tenantId, userIds);
    return students
      .filter((s) => userById.has(s.userId))
      .map((s) =>
        toAdminDto(userById.get(s.userId), s, counts[s.userId] || 0, false),
      );
  }

  static async adminGetStudent(tenantId, userId) {
    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }
    const user = await UserManager.getUserBy({ id: userId }, true);
    if (!user) {
      throw { message: "Student not found", status: 404 };
    }
    const counts = await ApplicationManager.countByStudents(tenantId, [userId]);
    return toAdminDto(user, student, counts[userId] || 0, true);
  }

  static async adminUpdateStudent(tenantId, userId, payload) {
    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }
    await StudentService.updateStudentProfile(userId, payload);
    return StudentService.adminGetStudent(tenantId, userId);
  }

  static async blockStudent(tenantId, userId) {
    return StudentService._setStudentSuspended(
      tenantId,
      userId,
      true,
      "account_blocked",
    );
  }

  static async unblockStudent(tenantId, userId) {
    return StudentService._setStudentSuspended(tenantId, userId, false, null);
  }

  static async _setStudentSuspended(tenantId, userId, suspended, revokeReason) {
    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }
    await setSuspended(userId, suspended);
    if (revokeReason) {
      await JwtHelper.revokeAllUserTokens(userId, revokeReason);
    }
    await AuditLogService.record(
      tenantId,
      "update",
      suspended
        ? `Schüler*in ${userId} gesperrt`
        : `Schüler*in ${userId} entsperrt`,
    );
    return StudentService.adminGetStudent(tenantId, userId);
  }

  static async adminDeleteStudent(tenantId, userId) {
    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }
    await OfferBookmarkManager.removeByUser(userId);
    await ApplicationService.deleteByStudent(userId);
    await StudentManager.removeStudent(userId);
    await MembershipManager.removeMembership(tenantId, userId);
    await JwtHelper.revokeAllUserTokens(userId, "account_deleted_by_admin");
    const remaining = await MembershipManager.getMembershipsByUserID(userId);
    if (!remaining || remaining.length === 0) {
      await UserManager.deleteUser(userId);
    }
    await AuditLogService.record(
      tenantId,
      "delete",
      `Schüler*in ${userId} durch Admin gelöscht`,
    );
    return { deleted: userId };
  }

  static async adminListStudentApplications(tenantId, userId) {
    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }
    return ApplicationService.listMyApplications(tenantId, userId);
  }
}

module.exports = StudentService;
