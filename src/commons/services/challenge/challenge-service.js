const ChallengeManager = require("../../data-managers/challenge-manager");
const UserManager = require("../../data-managers/user-manager");

/**
 * Base ChallengeService class that provides the interface for all challenge types
 */
class ChallengeService {
  /**
   * Factory method to create the appropriate challenge service based on the challenge key
   * @param {string} challengeKey - The key identifying the challenge type
   * @returns {ChallengeService} - An instance of the appropriate challenge service
   */
  static createService(challengeKey) {
    switch (challengeKey) {
      case "domainEmail":
        return new DomainChallengeService();
      case "manualApproval":
        return new ManualApprovalChallengeService();
      default:
        throw new Error(`Unknown challenge type: ${challengeKey}`);
    }
  }

  /**
   * Perform a challenge for a user
   * @param {string} challengeId - The ID of the challenge
   * @param {string} userId - The ID of the user
   * @param {string} tenantId - The ID of the tenant
   * @returns {Promise<{success: boolean, message: string}>} - The result of the challenge
   */
  static async performChallenge(challengeId, userId, tenantId) {
    // Get the challenge details
    const challenge = await ChallengeManager.getChallengeByID(
      tenantId,
      challengeId,
    );

    if (!challenge) {
      throw { message: "Challenge not found", code: 404 };
    }

    if (!challenge.enabled) {
      throw { message: "Challenge is disabled", code: 400 };
    }

    // Create the appropriate challenge service
    const service = ChallengeService.createService(challenge.key);

    // Perform the challenge
    return await service.execute(challenge, userId, tenantId);
  }

  /**
   * Execute the challenge (to be implemented by subclasses)
   * @param {Object} challenge - The challenge details
   * @param {string} userId - The ID of the user
   * @param {string} tenantId - The ID of the tenant
   * @returns {Promise<{success: boolean, message: string}>} - The result of the challenge
   */
  async execute(challenge, userId, tenantId) {
    throw new Error("Method 'execute' must be implemented by subclasses");
  }
}

/**
 * Domain Challenge Service - Verifies if a user's email has the correct domain
 */
class DomainChallengeService extends ChallengeService {
  /**
   * Execute the domain challenge
   * @param {Object} challenge - The challenge details
   * @param {string} userId - The ID of the user
   * @param {string} tenantId - The ID of the tenant
   * @returns {Promise<{success: boolean, message: string}>} - The result of the challenge
   */
  async execute(challenge, userId, tenantId) {
    // Get the user details to check their email
    const user = await UserManager.getUser(userId);

    if (!user) {
      return { success: false, message: "USER_NOT_FOUND" };
    }

    // Get the allowed domains from the challenge config
    const allowedDomains = (challenge.defaultConfig?.allowedDomains || [])
      .map((d) => String(d).toLowerCase().trim())
      .filter(Boolean);

    if (allowedDomains.length === 0) {
      return {
        success: false,
        message: "NO_ALLOWED_DOMAINS_DEFINED",
      };
    }

    // Extract the domain from the user's email
    const email = String(user.id || "")
      .toLowerCase()
      .trim();
    const at = email.lastIndexOf("@");
    if (at <= 0 || at === email.length - 1) {
      return { success: false, message: "INVALID_DOMAIN" };
    }
    const emailDomain = email.substring(at + 1);

    // Check if the user's email domain is in the allowed domains
    if (allowedDomains.includes(emailDomain)) {
      return {
        success: true,
        message: "DOMAIN_VERIFIED",
      };
    } else {
      return {
        success: false,
        message: "INVALID_DOMAIN",
      };
    }
  }
}

/**
 * Manual Approval Challenge Service - Requires an admin to approve the challenge
 */
class ManualApprovalChallengeService extends ChallengeService {
  /**
   * Execute the manual approval challenge
   * @param {Object} challenge - The challenge details
   * @param {string} userId - The ID of the user
   * @param {string} tenantId - The ID of the tenant
   * @returns {Promise<{success: boolean, message: string, pendingApproval: boolean}>} - The result of the challenge
   */
  async execute(challenge, userId, tenantId) {
    // Check if the user has already been approved for this challenge
    const approvals = challenge.defaultConfig.approvals || {};

    if (approvals[userId]) {
      return {
        success: true,
        message: "MANUAL_APPROVAL_GRANTED",
      };
    } else {
      // Mark the challenge as pending approval
      return {
        success: true,
        message: "MANUAL_APPROVAL_PENDING",
        pendingApproval: true,
      };
    }
  }
}

// Export both the main ChallengeService and the specific challenge services
module.exports = ChallengeService;
module.exports.DomainChallengeService = DomainChallengeService;
module.exports.ManualApprovalChallengeService = ManualApprovalChallengeService;
