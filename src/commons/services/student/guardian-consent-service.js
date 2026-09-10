const crypto = require("crypto");
const bunyan = require("bunyan");
const { isEmail } = require("validator");
const StudentManager = require("../../data-managers/student-manager");
const UserManager = require("../../data-managers/user-manager");
const AuditLogService = require("../audit-log-service");
const { createResendThrottle } = require("../../utilities/resend-throttle");
const { sendGuardianConsentRequest } = require("./guardian-consent-mail");

const logger = bunyan.createLogger({
  name: "guardian-consent-service.js",
  level: process.env.LOG_LEVEL,
});

const CONSENT_AGE = 16;
const resendThrottle = createResendThrottle();

function sixteenthBirthday(birthDate) {
  const [year, month, day] = String(birthDate || "")
    .split("-")
    .map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return Date.UTC(year + CONSENT_AGE, month - 1, day);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function createToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

class GuardianConsentService {
  static isPending(student) {
    return (
      !!student &&
      student.guardianConsentRequiredUntil != null &&
      Date.now() < student.guardianConsentRequiredUntil &&
      !student.guardianConsentAt
    );
  }

  static requiredUntilFor(birthDate) {
    return sixteenthBirthday(birthDate);
  }

  static isRequiredFor(birthDate) {
    const threshold = sixteenthBirthday(birthDate);
    return threshold != null && threshold > Date.now();
  }

  static buildForRegistration(birthDate, guardianEmail, studentEmail) {
    if (!GuardianConsentService.isRequiredFor(birthDate)) {
      return { fields: {}, token: null };
    }

    const email = String(guardianEmail || "")
      .trim()
      .toLowerCase();
    if (!isEmail(email)) {
      throw {
        message:
          "A valid guardian email address is required for students under 16",
        status: 400,
      };
    }
    GuardianConsentService._assertNotSelf(email, studentEmail);

    const { token, hash } = createToken();
    return {
      fields: {
        guardianEmail: email,
        guardianConsentRequiredUntil: sixteenthBirthday(birthDate),
        guardianConsentAt: null,
        guardianConsentTokenHash: hash,
        guardianConsentSentAt: Date.now(),
      },
      token,
    };
  }

  static async getStatus(userId) {
    const student = await StudentManager.getStudentByUser(userId);
    return {
      required: GuardianConsentService.isPending(student),
      consented: !!student?.guardianConsentAt,
      guardianEmail: student?.guardianEmail || "",
      consentedAt: student?.guardianConsentAt || null,
      consentedBy: student?.guardianConsentBy || "",
      lastSentAt: student?.guardianConsentSentAt || null,
    };
  }

  static async resend(tenantId, userId, guardianEmail) {
    const replacement = String(guardianEmail || "")
      .trim()
      .toLowerCase();
    if (replacement && !isEmail(replacement)) {
      throw {
        message: "A valid guardian email address is required",
        status: 400,
      };
    }
    if (replacement) {
      GuardianConsentService._assertNotSelf(replacement, userId);
    }

    const throttleKey = `guardian:${tenantId}:${userId}`;
    resendThrottle.assertNotThrottled(throttleKey);
    resendThrottle.arm(throttleKey);

    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }
    if (!GuardianConsentService.isPending(student)) {
      return { sent: false };
    }

    const { token, hash } = createToken();
    if (replacement) {
      student.guardianEmail = replacement;
    }
    student.guardianConsentTokenHash = hash;
    student.guardianConsentSentAt = Date.now();
    await StudentManager.storeStudent(student);

    const user = await UserManager.getUserBy({ id: userId }, false);
    await sendGuardianConsentRequest({
      sendTo: student.guardianEmail,
      firstName: user ? user.firstName : "",
      lastName: user ? user.lastName : "",
      token,
    });

    return { sent: true };
  }

  static async lookup(tenantId, token) {
    const student = await GuardianConsentService._resolve(tenantId, token);
    const user = await UserManager.getUserBy({ id: student.userId }, false);
    return {
      firstName: user ? user.firstName : "",
      lastName: user ? user.lastName : "",
    };
  }

  static async confirm(tenantId, token) {
    const student = await GuardianConsentService._resolve(tenantId, token);

    student.guardianConsentAt = Date.now();
    student.guardianConsentBy = "";
    student.guardianConsentTokenHash = "";
    await StudentManager.storeStudent(student);

    await AuditLogService.record(
      tenantId,
      "update",
      `Einwilligung der Erziehungsberechtigten für ${student.userId} erteilt`,
    );
    logger.info(`Guardian consent granted for student ${student.userId}`);

    return { consentedAt: student.guardianConsentAt };
  }

  static async adminSetConsent(tenantId, userId, adminUserId, granted) {
    const student = await StudentManager.getStudentByUser(userId);
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Student not found", status: 404 };
    }

    if (granted) {
      student.guardianConsentAt = Date.now();
      student.guardianConsentBy = adminUserId;
      student.guardianConsentTokenHash = "";
    } else {
      student.guardianConsentAt = null;
      student.guardianConsentBy = "";
    }
    await StudentManager.storeStudent(student);

    await AuditLogService.record(
      tenantId,
      "update",
      granted
        ? `Einwilligung für ${userId} manuell durch ${adminUserId} freigegeben`
        : `Manuelle Einwilligungsfreigabe für ${userId} durch ${adminUserId} zurückgenommen`,
    );
    logger.info(
      `Guardian consent for ${userId} ${granted ? "granted" : "revoked"} by admin ${adminUserId}`,
    );

    return GuardianConsentService.getStatus(userId);
  }

  static _assertNotSelf(guardianEmail, studentEmail) {
    const own = String(studentEmail || "")
      .trim()
      .toLowerCase();
    if (own && guardianEmail === own) {
      throw {
        message: "The guardian email address must differ from your own",
        status: 400,
      };
    }
  }

  static async _resolve(tenantId, token) {
    const raw = String(token || "").trim();
    if (!raw) {
      throw { message: "Token is required", status: 400 };
    }
    const student = await StudentManager.getStudentByGuardianToken(
      hashToken(raw),
    );
    if (!student || student.tenantId !== tenantId) {
      throw { message: "Invalid or already used consent link", status: 404 };
    }
    return student;
  }
}

module.exports = GuardianConsentService;
