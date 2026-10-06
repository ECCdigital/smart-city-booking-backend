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
   * Get the access points of a tenant for a list of ids. Ids the tenant does
   * not know are left out, the result is not ordered like the given ids.
   *
   * @param {string} tenantId The tenant id
   * @param {string[]} ids Logical identifiers of the access points
   * @returns {Promise<AccessPoint[]>} The access points that exist
   */
  static async getAccessPointsByIds(tenantId, ids = []) {
    if (ids.length === 0) return [];

    const rawAccessPoints = await AccessPointModel.find({
      tenantId: tenantId,
      id: { $in: ids },
    });
    return rawAccessPoints.map((doc) => doc.toEntity());
  }

  /**
   * Get the access point a scanned code belongs to. Matches the current scan
   * code as well as the codes it replaced, so a sticker that is still out in
   * the field can be told apart from a code nobody ever issued. Callers
   * distinguish the two by comparing the code to `scanCode`.
   *
   * @param {string} tenantId The tenant id
   * @param {string} scanCode The scanned code
   * @returns {Promise<AccessPoint|null>} The access point or null
   */
  static async getAccessPointByScanCode(tenantId, scanCode) {
    const rawAccessPoint = await AccessPointModel.findOne({
      tenantId: tenantId,
      $or: [{ scanCode: scanCode }, { previousScanCodes: scanCode }],
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

  /**
   * Remove an access point of a tenant.
   *
   * @param {string} id Logical identifier of the access point
   * @param {string} tenantId The tenant id
   * @returns {Promise<void>}
   */
  static async removeAccessPoint(id, tenantId) {
    await AccessPointModel.deleteOne({ id: id, tenantId: tenantId });
  }
}

module.exports = AccessPointManager;
