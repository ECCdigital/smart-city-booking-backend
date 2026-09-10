const bunyan = require("bunyan");
const StudentManager = require("../commons/data-managers/student-manager");
const GuardianConsentService = require("../commons/services/student/guardian-consent-service");

const logger = bunyan.createLogger({
  name: "guardian-consent-middleware.js",
  level: process.env.LOG_LEVEL,
});

const requireGuardianConsent = async (req, res, next) => {
  const userId = req.user && req.user.id;
  if (!userId) {
    return next();
  }

  try {
    const student = await StudentManager.getStudentByUser(userId);
    if (!GuardianConsentService.isPending(student)) {
      return next();
    }
  } catch (error) {
    logger.error(`Could not check guardian consent for ${userId}`, error);
    return res.sendStatus(500);
  }

  return res.status(403).json({
    message:
      "Für dieses Konto fehlt noch die Einwilligung der Erziehungsberechtigten.",
    reason: "guardian_consent_pending",
  });
};

module.exports = { requireGuardianConsent };
