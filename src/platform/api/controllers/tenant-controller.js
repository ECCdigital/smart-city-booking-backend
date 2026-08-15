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
const PaymentUtils = require("../../../commons/utilities/payment-utils");
const SupervisorNotificationService = require("../../../commons/services/supervisor-notification-service");
const AccessAppLifecycleService = require("../../../commons/services/access/access-app-lifecycle-service");
const {
  validateMailSnippets,
  validateMailSubjects,
} = require("../../../commons/mail-service/templates/mail-snippet-overrides");
const {
  mergeDefaultMailSnippets,
} = require("../../../commons/mail-service/templates/default-mail-snippets");
const {
  normalizeUserId,
  userIdsMatch,
} = require("../../../commons/utilities/user-id-utils");
const PdfService = require("../../../commons/pdf-service/pdf-service");
const {
  isValidBookingLayout,
} = require("../../../commons/pdf-service/pdf-booking-layout");
const {
  validatePdfBookingTableMeta,
} = require("../../../commons/pdf-service/pdf-booking-table-meta");
const {
  getCancellationRefundTiersError,
} = require("../../../commons/utilities/cancellation-refund-tiers");
const Formatters = require("../../../commons/utilities/formatters");

const PDF_TEMPLATE_FIELDS = {
  receiptTemplate: "receipt",
  invoiceTemplate: "invoice",
  cancellationTemplate: "cancellation",
};

/**
 * Validates all PDF templates contained in a request body. Returns an error
 * message or null when all provided templates are valid. Empty templates are
 * allowed (the default template is used in that case).
 */
function validatePdfTemplates(body) {
  for (const field of Object.keys(PDF_TEMPLATE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const template = body[field];
    if (!template) continue;

    const errors = PdfService.validateTemplate(template);
    if (errors.length) {
      return `Invalid PDF template "${field}": ${errors.join("; ")}`;
    }
  }
  return null;
}

function validatePdfBookingLayout(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "pdfBookingLayout")) {
    return null;
  }
  if (!body.pdfBookingLayout || isValidBookingLayout(body.pdfBookingLayout)) {
    return null;
  }
  return `Invalid pdfBookingLayout "${body.pdfBookingLayout}". Allowed values: summary, compact, detailed`;
}

function validateMailBookingPeriodFormat(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "mailBookingPeriodFormat")) {
    return null;
  }
  if (
    Formatters.MAIL_BOOKING_PERIOD_FORMATS.includes(
      body.mailBookingPeriodFormat,
    )
  ) {
    return null;
  }
  return `Invalid mailBookingPeriodFormat "${body.mailBookingPeriodFormat}". Allowed values: ${Formatters.MAIL_BOOKING_PERIOD_FORMATS.join(", ")}`;
}

function validatePdfBookingTableMetaField(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "pdfBookingTableMeta")) {
    return null;
  }
  return validatePdfBookingTableMeta(body.pdfBookingTableMeta);
}

function validateCancellationRefundTiersField(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "cancellationRefundTiers")) {
    return null;
  }
  return getCancellationRefundTiersError(body.cancellationRefundTiers);
}

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

      if (Object.prototype.hasOwnProperty.call(request.body, "mailSnippets")) {
        try {
          validateMailSnippets(request.body.mailSnippets);
        } catch (error) {
          return response.status(400).send(error.message);
        }
      }

      if (Object.prototype.hasOwnProperty.call(request.body, "mailSubjects")) {
        try {
          validateMailSubjects(request.body.mailSubjects);
        } catch (error) {
          return response.status(400).send(error.message);
        }
      }

      const templateError = validatePdfTemplates(request.body);
      if (templateError) {
        return response.status(400).send(templateError);
      }

      const layoutError = validatePdfBookingLayout(request.body);
      if (layoutError) {
        return response.status(400).send(layoutError);
      }

      const tableMetaError = validatePdfBookingTableMetaField(request.body);
      if (tableMetaError) {
        return response.status(400).send(tableMetaError);
      }

      const mailBookingPeriodFormatError = validateMailBookingPeriodFormat(
        request.body,
      );
      if (mailBookingPeriodFormatError) {
        return response.status(400).send(mailBookingPeriodFormatError);
      }

      const cancellationRefundTiersError = validateCancellationRefundTiersField(
        request.body,
      );
      if (cancellationRefundTiersError) {
        return response.status(400).send(cancellationRefundTiersError);
      }

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
        tenant.mailSnippets = mergeDefaultMailSnippets(tenant.mailSnippets);

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
          "mailSnippets",
          "mailSubjects",
          "mailShowSupportFooter",
          "mailBookingPeriodFormat",
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
          "notifySupervisorsOnBooking",
          "catalogParticipation",
          "bookableCustomFields",
          "cancellationTemplate",
          "cancellationNumberPrefix",
          "cancellationRefundTiers",
          "pdfBookingLayout",
          "pdfBookingTableMeta",
        ];

        if (
          Object.prototype.hasOwnProperty.call(request.body, "mailSnippets")
        ) {
          try {
            validateMailSnippets(request.body.mailSnippets);
          } catch (error) {
            return response.status(400).send(error.message);
          }
        }

        if (
          Object.prototype.hasOwnProperty.call(request.body, "mailSubjects")
        ) {
          try {
            validateMailSubjects(request.body.mailSubjects);
          } catch (error) {
            return response.status(400).send(error.message);
          }
        }

        const templateError = validatePdfTemplates(request.body);
        if (templateError) {
          return response.status(400).send(templateError);
        }

        const layoutError = validatePdfBookingLayout(request.body);
        if (layoutError) {
          return response.status(400).send(layoutError);
        }

        const tableMetaError = validatePdfBookingTableMetaField(request.body);
        if (tableMetaError) {
          return response.status(400).send(tableMetaError);
        }

        const mailBookingPeriodFormatError = validateMailBookingPeriodFormat(
          request.body,
        );
        if (mailBookingPeriodFormatError) {
          return response.status(400).send(mailBookingPeriodFormatError);
        }

        const cancellationRefundTiersError =
          validateCancellationRefundTiersField(request.body);
        if (cancellationRefundTiersError) {
          return response.status(400).send(cancellationRefundTiersError);
        }

        fields.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(request.body, field)) {
            tenant[field] = request.body[field];
          }
        });

        await AccessAppLifecycleService.syncWebhooks(
          await TenantManager.getTenant(request.body.id),
          tenant,
        );

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

  /**
   * Renders a preview PDF for a template with generated sample data
   * (including enough line items to span multiple pages). The template can be
   * passed in the request body to preview unsaved changes; otherwise the
   * template stored on the tenant (or the default template) is used.
   */
  static async previewPdfTemplate(request, response) {
    try {
      const user = request.user;
      const tenantId = request.params.id;
      const { templateType, template, pdfBookingLayout, pdfBookingTableMeta } =
        request.body;

      if (
        !(await PermissionService._isTenantOwner(user.id, tenantId)) &&
        !(await PermissionService._isInstanceOwner(user.id))
      ) {
        return response.sendStatus(403);
      }

      const layoutError = validatePdfBookingLayout(request.body);
      if (layoutError) {
        return response.status(400).send(layoutError);
      }

      const tableMetaError = validatePdfBookingTableMetaField(request.body);
      if (tableMetaError) {
        return response.status(400).send(tableMetaError);
      }

      if (!["receipt", "invoice", "cancellation"].includes(templateType)) {
        return response
          .status(400)
          .send("templateType must be one of: receipt, invoice, cancellation");
      }

      if (template) {
        const errors = PdfService.validateTemplate(template);
        if (errors.length) {
          return response
            .status(400)
            .send(`Invalid PDF template: ${errors.join("; ")}`);
        }
      }

      const pdfData = await PdfService.generatePreview(
        tenantId,
        templateType,
        template || null,
        pdfBookingLayout || null,
        pdfBookingTableMeta || null,
      );

      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `inline; filename="${pdfData.name}"`,
      );
      response.status(200).send(pdfData.buffer);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not generate PDF preview");
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
      const activeApps = paymentApps.filter((app) => app.active);

      const filteredPaymentApps = [];
      for (const app of activeApps) {
        if (app.id === "invoice") {
          const isPermitted = await PaymentUtils.checkInvoicePermission(
            tenantId,
            user?.id,
          );
          if (!isPermitted) continue;
        }
        filteredPaymentApps.push({ id: app.id, title: app.title });
      }

      logger.info(
        `${tenantId} -- sending ${filteredPaymentApps.length} payment apps to user ${user?.id}`,
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
      const userId = normalizeUserId(body.userId);
      const type = body.type || "manually";

      if (!userId) {
        return response.status(400).send("User ID is required");
      }

      if (
        await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        const membership =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userAlreadyInTenant = membership.find((m) =>
          userIdsMatch(m.userId, userId),
        );
        if (userAlreadyInTenant) {
          return response.status(400).send("User already in tenant");
        }

        if (type === "manually") {
          const existingUser = await UserManager.getUser(userId);

          if (!existingUser) {
            return response.status(404).send("User does not exist");
          }

          const newMembership = new Membership({
            tenantId,
            userId,
            status: "active",
            source: "manually",
            roles: roles || [],
            invitations: [],
          });

          await MembershipManager.addMembership(tenantId, newMembership);
        } else {
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
            status: "pending",
            source: type,
            invitations: [{ token: invitation.token, status: "pending" }],
          });

          await MembershipManager.addMembership(tenantId, newMembership);

          await InvitationService.sendInvitationMail(
            tenantId,
            invitation.token,
            userId,
          );
        }

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
      response
        .status(error.code || 500)
        .send(error.message || "Could not add user to tenant");
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
      const userId = normalizeUserId(request.body.userId);
      const user = request.user;

      if (!userId) {
        return response.status(400).send("User ID is required");
      }

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

  static async updateUserBookingNotificationRecipients(request, response) {
    try {
      const tenantId = request.params.id;
      const { userId, bookingNotificationRecipients } = request.body;
      const user = request.user;

      if (!userId) {
        return response.status(400).send("User ID is required");
      }

      if (
        await PermissionService._allowUpdateAny(
          user.id,
          tenantId,
          RolePermission.MANAGE_USERS,
        )
      ) {
        const membership =
          await MembershipManager.getMembershipByTenantAndUserID(
            tenantId,
            userId,
          );

        if (!membership) {
          return response.status(404).send("Membership not found");
        }

        let recipients;
        try {
          recipients =
            await SupervisorNotificationService.prepareRecipientsForWrite(
              tenantId,
              bookingNotificationRecipients,
            );
        } catch (error) {
          logger.warn(
            `${tenantId} - Invalid booking notification recipients provided by user ${user?.id}: ${error.message}`,
          );
          return response.status(400).send(error.message);
        }

        await MembershipManager.updateMembership(tenantId, userId, {
          bookingNotificationRecipients: recipients,
        });

        const updatedMemberships =
          await MembershipManager.getMembershipsByTenantID(tenantId);

        const userDetails = await UserManager.getUsersById(
          updatedMemberships.map((m) => m.userId),
        );

        logger.info(
          `${tenantId} - User ${user?.id} updated booking notification recipients for user ${userId}`,
        );

        response.status(200).send({
          users: updatedMemberships,
          userDetails: userDetails,
        });
      } else {
        logger.warn(
          `${tenantId} - User ${user?.id} not allowed to update booking notification recipients`,
        );
        response.sendStatus(403);
      }
    } catch (error) {
      logger.error(error);
      response
        .status(500)
        .send("Could not update booking notification recipients");
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
