/**
 * Introduces the role group `manageMedia` and the admin interface `media`.
 *
 * Media used to be a side effect of managing bookables: whoever could edit a
 * bookable could upload its image. To keep every existing workflow intact, each
 * role mirrors its `manageBookables` permissions into `manageMedia`, and roles
 * that manage a bookable admin interface also get the media one.
 */

const MEDIA_INTERFACE = "media";

// Interfaces whose editors upload images today.
const BOOKABLE_INTERFACES = ["rooms", "resources", "tickets", "events"];

const ACTIONS = [
  "create",
  "readAny",
  "readOwn",
  "updateAny",
  "updateOwn",
  "deleteAny",
  "deleteOwn",
];

/**
 * Copies the seven `manageBookables` booleans onto `manageMedia`.
 *
 * @param {Object} role - The role document.
 * @returns {boolean} True if the role changed.
 */
function mirrorMediaPermissions(role) {
  const source = role.manageBookables || {};
  const target = role.manageMedia || {};
  let changed = false;

  for (const action of ACTIONS) {
    const mirrored = source[action] === true;

    if (target[action] !== mirrored) {
      target[action] = mirrored;
      changed = true;
    }
  }

  role.manageMedia = target;

  return changed;
}

/**
 * Adds the `media` admin interface to roles that manage bookable interfaces.
 *
 * @param {Object} role - The role document.
 * @returns {boolean} True if the role changed.
 */
function addMediaInterface(role) {
  const interfaces = role.adminInterfaces || [];

  if (interfaces.includes(MEDIA_INTERFACE)) {
    return false;
  }

  if (!interfaces.some((value) => BOOKABLE_INTERFACES.includes(value))) {
    return false;
  }

  role.adminInterfaces = [...interfaces, MEDIA_INTERFACE];

  return true;
}

module.exports = {
  name: "26-08-2026-add-manage-media-role-group",

  mirrorMediaPermissions,
  addMediaInterface,

  up: async function (mongoose) {
    const Role = mongoose.model("Role");

    const roles = await Role.find({});

    for (const role of roles) {
      const permissionsChanged = mirrorMediaPermissions(role);
      const interfacesChanged = addMediaInterface(role);

      if (!permissionsChanged && !interfacesChanged) {
        continue;
      }

      if (permissionsChanged) {
        role.markModified("manageMedia");
      }
      if (interfacesChanged) {
        role.markModified("adminInterfaces");
      }

      await role.save();
    }
  },

  down: async function (mongoose) {
    const Role = mongoose.model("Role");

    await Role.updateMany(
      {},
      {
        $unset: { manageMedia: "" },
        $pull: { adminInterfaces: MEDIA_INTERFACE },
      },
    );
  },
};
