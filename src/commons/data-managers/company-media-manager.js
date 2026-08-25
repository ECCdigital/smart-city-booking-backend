const CompanyMedia = require("../entities/company/companyMedia");
const CompanyMediaModel = require("./models/companyMediaModel");

class CompanyMediaManager {
  static async getMediaByCompany(tenantId, companyId) {
    const raw = await CompanyMediaModel.find({ tenantId, companyId }).sort({
      created: 1,
    });
    return raw.map((doc) => doc.toEntity());
  }

  static async getMedia(tenantId, id) {
    const raw = await CompanyMediaModel.findOne({ tenantId, id });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async storeMedia(media, upsert = true) {
    const mediaEntity =
      media instanceof CompanyMedia ? media : new CompanyMedia(media);
    mediaEntity.validate();
    // pass a copy: Mongoose mutates the update object with $setOnInsert on upsert
    await CompanyMediaModel.updateOne(
      { id: mediaEntity.id, tenantId: mediaEntity.tenantId },
      { ...mediaEntity },
      { upsert, runValidators: true },
    );
    return mediaEntity;
  }

  static async removeMedia(tenantId, id) {
    await CompanyMediaModel.deleteOne({ tenantId, id });
  }
}

module.exports = CompanyMediaManager;
