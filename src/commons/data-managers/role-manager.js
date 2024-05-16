const dbm = require("../utilities/database-manager");
const { validate } = require("jsonschema");
const { Role } = require("../entities/role");

/**
 * Data Manager for role objects. Role objects determine the permissions for users.
 *
 * @author Lennard Scheffler, lennard.scheffler@e-c-crew.de
 */
class RoleManager {
  /**
   * Check if an object is a valid Role.
   *
   * @param {object} role A role object
   * @returns true, if the object is a valid role object
   */
  static validateRole(role) {
    var schema = require("../schemas/role.schema.json");
    return validate(role, schema).errors.length === 0;
  }

  /**
   * Get all roles
   * @returns List of bookings
   */
  static getRoles() {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("roles")
        .find({})
        .toArray()
        .then((rawRoles) => {
          var roles = rawRoles.map((rr) => {
            return Object.assign(new Role(), rr);
          });

          resolve(roles);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Get a specific role object from the database.
   *
   * @param {string} id Logical identifier of the role object
   * @returns A single role object
   */
  static getRole(id) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("roles")
        .findOne({ id: id })
        .then((rawRole) => {
          var role = Object.assign(new Role(), rawRole);
          resolve(role);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   * Insert a role object into the database or update it.
   *
   * @param {Role} role The role object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static storeRole(role, upsert = true) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("roles")
        .replaceOne({ id: role.id }, role, {
          upsert: upsert,
        })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }

  /**
   * Remove a role object from the database.
   *
   * @param {Role} role The role object to be stored.
   * @param {boolean} upsert true, if new object should be inserted. Default: true
   * @returns Promise<>
   */
  static removeRole(id) {
    return new Promise((resolve, reject) => {
      dbm
        .get()
        .collection("roles")
        .deleteOne({ id: id })
        .then(() => resolve())
        .catch((err) => reject(err));
    });
  }
}

module.exports = RoleManager;
