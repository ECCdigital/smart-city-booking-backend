const { AccessPoint } = require("../entities/access/access-point");
const AccessPointModel = require("./models/accessPointModel");

/**
 * Data Manager for access point objects. Access points are tenant-wide, every
 * lookup is scoped to a tenant.
 */
class AccessPointManager {
  /**
   * Get all access points of a tenant.
   *
   * @param {string} tenantId The tenant id
   * @returns {Promise<AccessPoint[]>} List of access points
   */
  static async getAccessPoints(tenantId) {
    const rawAccessPoints = await AccessPointModel.find({ tenantId: tenantId });
    return rawAccessPoints.map((doc) => doc.toEntity());
  }

  /**
   * Get a specific access point of a tenant.
   *
   * @param {string} id Logical identifier of the access point
   * @param {string} tenantId The tenant id
   * @returns {Promise<AccessPoint|null>} A single access point or null
   */
  static async getAccessPoint(id, tenantId) {
    const rawAccessPoint = await AccessPointModel.findOne({
      id: id,
      tenantId: tenantId,
    });
    if (!rawAccessPoint) return null;
    return rawAccessPoint.toEntity();
  }

  /**
   * Insert an access point into the database or update it.
   *
   * @param {AccessPoint|Object} accessPoint The access point to be stored
   * @param {string} tenantId The tenant id
   * @returns {Promise<AccessPoint>} The stored access point
   */
  static async storeAccessPoint(accessPoint, tenantId) {
    const accessPointEntity =
      accessPoint instanceof AccessPoint
        ? accessPoint
        : new AccessPoint(accessPoint);
    accessPointEntity.tenantId = tenantId;
    accessPointEntity.validate();

    await AccessPointModel.findOneAndUpdate(
      { id: accessPointEntity.id, tenantId: tenantId },
      accessPointEntity.toDocument(),
      { upsert: true },
    );

    return accessPointEntity;
  }
}

module.exports = AccessPointManager;
