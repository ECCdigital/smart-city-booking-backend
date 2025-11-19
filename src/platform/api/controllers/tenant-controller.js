const TenantManager = require("../../../commons/data-managers/tenant-manager");
const Tenant = require("../../../commons/entities/tenant/tenant");
const UserManager = require("../../../commons/data-managers/user-manager");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const PermissionService = require("../../../commons/services/permission-service");
const InstanceManger = require("../../../commons/data-managers/instance-manager");
const bunyan = require("bunyan");
const { readFileSync } = require("fs");
const { join } = require("path");
const { v4: uuidv4 } = require("uuid");
const { RolePermission } = require("../../../commons/entities/role/role");
const { RoleManager } = require("../../../commons/data-managers/role-manager");
const Membership = require("../../../commons/entities/tenant/membership");
const InvitationService = require("../../../commons/services/invitation-service");
const ChallengeManager = require("../../../commons/data-managers/challenge-manager");

const logger = bunyan.createLogger({
  name: "tenant-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for Bookables.
 */
class TenantController {
  static async getTenants(request, response) {
    try {
      const { user } = request;
      const publicTenants = request.query.publicTenants === "true";
      const permissions = await UserManager.getUserPermissions(user.id);
      const tenantIds = permissions.tenants.map((p) => p.tenantId);

      const tenants = await TenantManager.getTenants();

      const allowedTenants = [];
      for (const tenant of tenants) {
        if (publicTenants) {
          const publicTenant = tenant.exportPublic();
          if (tenantIds.includes(publicTenant.id)) {
            allowedTenants.push(publicTenant);
          }
        } else if (
          (await PermissionService._isTenantOwner(user.id, tenant.id)) ||
          (await PermissionService._isInstanceOwner(user.id))
        ) {
          allowedTenants.push(tenant);
        }
      }
      response.status(200).send(allowedTenants);
    } catch (error) {
      logger.error(error);
      response.sendStatus(500);
    }
  }

  static async getPublicTenants(request, response) {
    try {
      const tenants = await TenantManager.getTenants();
      const publicTenants = tenants.map((tenant) => tenant.exportPublic());
      response.status(200).send(publicTenants);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get public tenants");
    }
  }

  static async getTenant(request, response) {
    try {
      const user = request.user;
      const id = request.params.id;

      if (id) {
        const tenant = await TenantManager.getTenant(id);

        if (
          user &&
          ((await PermissionService._isTenantOwner(user.id, tenant.id)) ||
            (await PermissionService._isInstanceOwner(user.id)))
        ) {
          logger.info(
            `Sending tenant ${tenant.id} to user ${user?.id} with details`,
          );
          response.status(200).send(tenant);
        } else {
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `Could not get tenants by user ${user?.id}. Missing required parameters.`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not get tenant");
    }
  }

  static async storeTenant(request, response) {
    const tenant = new Tenant(request.body);
    let isUpdate;

    try {
      const existingTenant = await TenantManager.getTenant(tenant.id);
      isUpdate = !!(existingTenant && existingTenant.id);
    } catch (error) {
      logger.error(error);
      isUpdate = false;
    }

    if (isUpdate) {
      await TenantController.updateTenant(request, response);
    } else {
      await TenantController.createTenant(request, response);
    }
  }

  static async createTenant(request, response) {
    try {
      const user = request.user;
      const tenant = new Tenant(request.body);
      tenant.id = uuidv4();

      tenant.ownerUserIds = [user.id];
      if ((await TenantManager.checkTenantCount()) === false) {
        throw new Error(`Maximum number of tenants reached.`);
      }

      const instance = await InstanceManger.getInstance();

      const hasPermission =
        instance.allowAllUsersToCreateTenant ||
        instance.allowedUsersToCreateTenant.includes(user.id) ||
        instance.ownerUserIds.includes(user.id);

      if (hasPermission) {
        const membership = new Membership({
          tenantId: tenant.id,
          userId: user.id,
          roles: [],
          status: "active",
          source: "manually",
          owner: true,
        });

        const emailTemplate = readFileSync(
          join(
            __dirname,
            "../../../commons/mail-service/templates/default-generic-mail-template.temp.html",
          ),
          "utf8",
        );
        const receiptTemplate = readFileSync(
          join(
            __dirname,
            "../../../commons/pdf-service/templates/default-receipt-template.temp.html",
          ),
          "utf8",
        );

        const invoiceTemplate = readFileSync(
          join(
            __dirname,
            "../../../commons/pdf-service/templates/default-invoice-template.temp.html",
          ),
          "utf8",
        );

        tenant.genericMailTemplate = emailTemplate;
        tenant.receiptTemplate = receiptTemplate;
        tenant.invoiceTemplate = invoiceTemplate;

        await TenantManager.storeTenant(tenant);
        await MembershipManager.addMembership(tenant.id, membership);
        logger.info(`created tenant ${tenant.id} by user ${user?.id}`);

        response.sendStatus(201);
      } else {
        logger.warn(`User ${user?.id} not allowed to create tenant`);
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not create tenant");
    }
  }

  static async updateTenant(request, response) {
    try {
      const user = request.user;
      if (
        (await PermissionService._isTenantOwner(user.id, request.body.id)) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        const tenant = await TenantManager.getTenant(request.body.id);

        const fields = [
          "name",
          "contactName",
          "location",
          "mail",
          "phone",
          "website",
          "bookableDetailLink",
          "eventDetailLink",
          "genericMailTemplate",
          "useInstanceMail",
          "noreplyMail",
          "noreplyDisplayName",
          "noreplyHost",
          "noreplyPort",
          "noreplyUser",
          "noreplyPassword",
          "noreplyStarttls",
          "noreplyUseGraphApi",
          "noreplyGraphTenantId",
          "noreplyGraphClientId",
          "noreplyGraphClientSecret",
          "receiptTemplate",
          "receiptNumberPrefix",
          "receiptEnableBCC",
          "invoiceTemplate",
          "invoiceNumberPrefix",
          "paymentPurposeSuffix",
          "applications",
          "maxBookingAdvanceInMonths",
          "defaultEventCreationMode",
          "enablePublicStatusView",
          "notifyOnNewBooking",
          "catalogParticipation",
        ];

        fields.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(request.body, field)) {
            tenant[field] = request.body[field];
          }
        });

        const updatedTenant = await TenantManager.storeTenant(tenant);
        logger.info(`updated tenant ${tenant.id} by user ${user?.id}`);
        response.status(200).send(updatedTenant);
      } else {
        logger.warn(`User ${user?.id} not allowed to update tenant`);
        response.sendStatus(403);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not update tenant");
    }
  }

  static async removeTenant(request, response) {
    try {
      const user = request.user;
      const id = request.params.id;

      const tenant = await TenantManager.getTenant(id);

      if (id) {
        if (
          (await PermissionService._isTenantOwner(user.id, tenant.id)) ||
          (await PermissionService._isInstanceOwner(user.id))
        ) {
          await TenantManager.removeTenant(id);
          logger.info(`removed tenant ${id} by user ${user?.id}`);
          response.sendStatus(200);
        } else {
          logger.warn(`User ${user?.id} not allowed to remove tenant`);
          response.sendStatus(403);
        }
      } else {
        logger.warn(
          `Could not remove tenant by user ${user?.id}. Missing required parameters.`,
        );
        response.sendStatus(400);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not remove tenant");
    }
  }

  static async getActivePaymentApps(request, response) {
    try {
      const {
        params: { id: tenantId },
        user,
      } = request;

      const paymentApps = await TenantManager.getTenantAppByType(
        tenantId,
        "payment",
      );
      const filteredPaymentApps = paymentApps
        .filter((app) => app.active)
        .map((app) => ({
          id: app.id,
          title: app.title,
        }));

      logger.info(
        `${tenantId} -- sending ${paymentApps.length} payment apps to user ${user?.id}`,
      );
      response.status(200).send(filteredPaymentApps);
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not get payment apps");
    }
  }
  static async countCheck(request, response) {
    try {
      const isCreateAllowed = await TenantManager.checkTenantCount();
      response.status(200).send(isCreateAllowed);
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not check if creation is possible");
    }
  }

  static async getUsers(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      if (
        await PermissionService._allowReadAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        const memberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          memberships.map((m) => m.userId),
        );

        response.status(200).send({
          users: memberships,
          userDetails: userDetails,
        });
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get users");
    }
  }

  static async addUser(request, response) {
    try {
      const tenantId = request.params.id;
      const body = request.body;
      const user = request.user;

      const roles = body.roles;
      const challenges = body.challenges || [];
      const userId = body.userId;
      const type = body.type || "manually";

      if (
        await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        const membership =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userAlreadyInTenant = membership.find((m) => m.userId === userId);
        if (userAlreadyInTenant) {
          return response.status(400).send("User already in tenant");
        }

        const invitation = await InvitationService.createInvitation({
          tenantId,
          intendedUserId: userId,
          roles,
          challenges: challenges,
          type: "single",
          expiresAt: null,
          maxUses: 1,
        });

        const newMembership = new Membership({
          tenantId,
          userId,
          status: type === "manually" ? "active" : "pending",
          source: type,
          invitations: [{ token: invitation.token, status: "pending" }],
        });

        await MembershipManager.addMembership(tenantId, newMembership);

        await InvitationService.sendInvitationMail(
          tenantId,
          invitation.token,
          userId,
        );

        const memberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          memberships.map((m) => m.userId),
        );

        response.status(201).send({
          users: memberships,
          userDetails: userDetails,
        });
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not add user to tenant");
    }
  }

  static async removeUser(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId } = request.body;
      const user = request.user;

      if (
        await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        const userMembership =
          await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            user.id,
          );

        const targetMembership =
          await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            userId,
          );

        if (!userMembership.owner && targetMembership.owner) {
          return response
            .status(403)
            .send("Only owners can remove other owners");
        }

        await InvitationService.deleteUserInvitations(tenantId, userId);

        await MembershipManager.removeMembership(tenantId, userId);

        const updatedMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          updatedMemberships.map((m) => m.userId),
        );

        response.status(200).send({
          users: updatedMemberships,
          userDetails: userDetails,
        });
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user from tenant");
    }
  }

  static async removeUserRole(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId, roleId } = request.body;
      const user = request.user;

      if (
        await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        await MembershipManager.removeRoleFromMembership(
          tenantId,
          userId,
          roleId,
        );

        const updatedMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          updatedMemberships.map((m) => m.userId),
        );

        logger.info(
          `${tenantId} - User ${user?.id} removed role ${roleId} from user ${userId}`,
        );

        response.status(200).send({
          users: updatedMemberships,
          userDetails: userDetails,
        });
      } else {
        logger.warn(
          `${tenantId} - User ${user?.id} not allowed to remove user role`,
        );
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user role from tenant");
    }
  }

  static async editUserRole(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId, roles } = request.body;
      const user = request.user;

      console.log(roles);

      if (
        await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        const tenantRoles = await RoleManager.getTenantRoles(tenantId);
        const mappedRoles = tenantRoles.map((role) => role.id);

        const verifiedRoles = roles.filter((role) =>
          mappedRoles.includes(role),
        );
        const memberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);
        const userMembership = memberships.find((m) => m.userId === userId);

        userMembership.roles = verifiedRoles;

        console.log(userMembership);

        await MembershipManager.setRolesForMembership(
          tenantId,
          userId,
          verifiedRoles,
        );

        const updatedMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          updatedMemberships.map((m) => m.userId),
        );

        logger.info(
          `${tenantId} - User ${user?.id} edit roles from user ${userId}`,
        );

        response.status(200).send({
          users: updatedMemberships,
          userDetails: userDetails,
        });
      } else {
        logger.warn(
          `${tenantId} - User ${user?.id} not allowed to remove user role`,
        );
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user from tenant");
    }
  }

  static async addOwner(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId } = request.body;
      const user = request.user;

      if (
        (await PermissionService._isTenantOwner(user.id, tenantId)) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        const userMembership =
          await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            user.id,
          );

        if (!userMembership.owner) {
          return response.status(403).send("Only owners can add other owners");
        }

        const existingMembership =
          await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            userId,
          );

        if (!existingMembership) {
          const newMembership = new Membership({
            tenantId,
            userId,
            roles: [],
            status: "active",
            source: "manually",
            owner: true,
          });

          await MembershipManager.addMembership(tenantId, newMembership);
        } else if (!existingMembership.owner) {
          await MembershipManager.updateMembership(tenantId, userId, {
            owner: true,
          });
        }

        const updatedMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          updatedMemberships.map((m) => m.userId),
        );

        response.status(200).send({
          users: updatedMemberships,
          userDetails: userDetails,
        });
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not add owner to tenant");
    }
  }

  static async removeOwner(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId } = request.body;
      const user = request.user;

      const tenant = await TenantManager.getTenant(tenantId);

      if (
        (await PermissionService._isTenantOwner(user.id, tenant.id)) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        const existingMembership =
          await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            userId,
          );

        if (!existingMembership || !existingMembership.owner) {
          return response
            .status(400)
            .send("User is not an owner of the tenant");
        }

        const userMembership =
          await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            user.id,
          );

        if (!userMembership.owner) {
          return response
            .status(403)
            .send("Only owners can remove other owners");
        }

        const allMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const ownerMemberships = allMemberships.filter((m) => m.owner);

        if (ownerMemberships.length <= 1) {
          return response
            .status(400)
            .send("Cannot remove the last owner of the tenant");
        }

        await MembershipManager.updateMembership(tenantId, userId, {
          owner: false,
        });

        const updatedMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          updatedMemberships.map((m) => m.userId),
        );

        response.status(200).send({
          users: updatedMemberships,
          userDetails: userDetails,
        });
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove owner from tenant");
    }
  }

  static async updateUserStatus(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId, status } = request.body;
      const user = request.user;

      if (
        await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        await MembershipManager.updateMembership(tenantId, userId, {
          status,
        });

        const updatedMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          updatedMemberships.map((m) => m.userId),
        );

        logger.info(
          `${tenantId} - User ${user?.id} updated status for user ${userId} to ${status}`,
        );

        response.status(200).send({
          users: updatedMemberships,
          userDetails: userDetails,
        });
      } else {
        logger.warn(
          `${tenantId} - User ${user?.id} not allowed to update user status`,
        );
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not update user status in tenant");
    }
  }

  static async getChallenges(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;

      if (
        (await PermissionService._allowReadAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_TENANTS,
        )) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        const challenges =
          await ChallengeManager.getChallengesByTenantID(tenantId);
        response.status(200).send(challenges);
      } else {
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get challenges for tenant");
    }
  }

  static async createChallenge(request, response) {
    try {
      const tenantId = request.params.id;
      const body = request.body;
      const user = request.user;

      if (
        (await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_TENANTS,
        )) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        body.id = uuidv4();

        console.log(body);

        const challenge = await ChallengeManager.createChallenge(
          tenantId,
          body,
        );
        response.status(201).send(challenge);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not create challenge for tenant");
    }
  }

  static async updateChallenge(request, response) {
    try {
      const tenantId = request.params.tenant;
      const body = request.body;
      const user = request.user;

      if (
        (await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_TENANTS,
        )) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        const challenge = await ChallengeManager.updateChallenge(
          tenantId,
          body.id,
          body,
        );
        response.status(200).send(challenge);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not update challenge for tenant");
    }
  }

  static async deleteChallenge(request, response) {
    try {
      const tenantId = request.params.tenant;
      const user = request.user;
      const challengeID = request.params.id;

      if (
        (await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_TENANTS,
        )) ||
        (await PermissionService._isInstanceOwner(user.id))
      ) {
        await ChallengeManager.deleteChallenge(tenantId, challengeID);
        response.sendStatus(200);
      }
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not delete challenge for tenant");
    }
  }
}

module.exports = { TenantController };
