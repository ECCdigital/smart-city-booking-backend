const ChallengeModel = require("./models/challengeModel");
const Challenge = require("../entities/tenant/challenge");

class ChallengeManager {
  static async getChallengesByTenantID(tenantID) {
    const rawChallenges = await ChallengeModel.find({ tenantId: tenantID });
    return rawChallenges.map((raw) => raw.toEntity());
  }

  static async getChallengeByID(tenantID, challengeID) {
    const rawChallenge = await ChallengeModel.findOne({
      tenantId: tenantID,
      id: challengeID,
    });
    if (!rawChallenge) {
      return null;
    }
    return rawChallenge.toEntity();
  }

  static async createChallenge(tenantID, challenge) {
    const newChallenge = new Challenge({
      tenantId: tenantID,
      ...challenge,
    });
    const savedChallenge = await ChallengeModel.create(newChallenge);
    return savedChallenge.toEntity();
  }

  static async updateChallenge(tenantID, challengeID, challenge) {
    const updatedChallenge = await ChallengeModel.findOneAndUpdate(
      { tenantId: tenantID, id: challengeID },
      { $set: challenge },
      { new: true },
    );
    if (!updatedChallenge) {
      return null;
    }
    return updatedChallenge.toEntity();
  }

  static async deleteChallenge(tenantID, challengeID) {
    await ChallengeModel.deleteOne({ tenantId: tenantID, id: challengeID });
  }
}

module.exports = ChallengeManager;
