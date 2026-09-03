const TenantManager = require("../../../commons/data-managers/tenant-manager");
const Tenant = require("../../../commons/entities/tenant/tenant");
const UserManager = require("../../../commons/data-managers/user-manager");
const MembershipManager = require("../../../commons/data-managers/membership-manager");
const bunyan = require("bunyan");
const { readFileSync } = require("fs");
const { join } = require("path");
const { v4: uuidv4 } = require("uuid");
const { RoleManager } = require("../../../commons/data-managers/role-manager");
const Membership = require("../../../commons/entities/tenant/membership");
const InvitationService = require("../../../commons/services/invitation-service");
const ChallengeManager = require("../../../commons/data-managers/challenge-manager");
const PaymentUtils = require("../../../commons/utilities/payment-utils");
const MembershipService = require("../../../commons/services/membership/membership-service");
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
const {
  getLegalDocumentsError,
} = require("../../../commons/utilities/legal-documents");
const MediaReferenceGuard = require("../../../commons/services/media/media-reference-guard");
const {
  BaseError,
  ForbiddenError,
  NotFoundError,
} = require("../../../errors/BaseError");
const { decide, scopeOf } = require("../../../commons/services/authorization");
const ApiResponse = require("../../../commons/utilities/api-response");
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

function validateLegalDocumentsField(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "legalDocuments")) {
    return null;
  }
  return getLegalDocumentsError(body.legalDocuments);
}

const logger = bunyan.createLogger({
  name: "tenant-controller.js",
  level: process.env.LOG_LEVEL,
});

/**
 * Web Controller for the tenants. The right is the router's (`tenant.*`
 * for the tenant the route names, `tenantUser.*` for its members); a
 * handler hands `scopeOf(req)` on and never branches over rights. Left to
 * the adapter: the creation over the obsolete PUT (authorize spec §12) and
 * the protection of an owner against removal by a user manager.
 */
class TenantController {
  /** The 404 of a tenant the manager did not find. */
  static _notFound(response, id) {
    return ApiResponse.fail(
      response,
      new NotFoundError("tenant_not_found", { id }),
    );
  }

  /**
   * The tenants within the reach: in full the ones the user owns (every
   * one under `any`), with `?publicTenants=true` the public projection of
   * the ones the user is a member of.
   */
  static async getTenants(request, response) {
    try {
      const publicTenants = request.query.publicTenants === "true";

      const tenants = await TenantManager.getTenants(scopeOf(request), {
        owned: !publicTenants,
      });

      response
        .status(200)
        .send(
          tenants.map((tenant) =>
            publicTenants
              ? tenant.exportPublic()
              : AccessAppLifecycleService.redactBackendState(
                  tenant.exportWithMedia(),
                ),
          ),
        );
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
      const id = request.params.tenant;

      const tenant = await TenantManager.getTenant(id);
      if (!tenant) {
        return TenantController._notFound(response, id);
      }

      logger.info(
        `Sending tenant ${tenant.id} to user ${user?.id} with details`,
      );
      response
        .status(200)
        .send(
          AccessAppLifecycleService.redactBackendState(
            tenant.exportWithMedia(),
          ),
        );
    } catch (err) {
      logger.error(err);
      response.status(500).send("could not get tenant");
    }
  }

  /**
   * @deprecated Use createTenant or updateTenant instead.
   *
   * The route carries `tenant.update` for the tenant of the body; an
   * unknown id creates, which is the adapter's second decision
   * (`tenant.create`, authorize spec §12).
   */
  static async storeTenant(request, response, next) {
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
    } else if (decide(request.principal, "tenant", "create") !== "any") {
      return next(new ForbiddenError());
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

      const legalDocumentsError = validateLegalDocumentsField(request.body);
      if (legalDocumentsError) {
        return response.status(400).send(legalDocumentsError);
      }

      tenant.ownerUserIds = [user.id];
      if ((await TenantManager.checkTenantCount()) === false) {
        throw new Error(`Maximum number of tenants reached.`);
      }

      // `storeTenant` routes an unknown id here, so this is the second half
      // of the tenant write path and gets the same media check. A tenant that
      // does not exist yet owns no media, so any medium named here is
      // refused, which beats storing a reference nobody ever checked.
      await MediaReferenceGuard.assertTenantStorable(
        tenant,
        tenant.id,
        user.id,
      );

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
    } catch (err) {
      if (err instanceof BaseError) {
        return response.status(err.statusCode).send(err.toJSON());
      }

      logger.error(err);
      response.status(500).send("could not create tenant");
    }
  }

  static async updateTenant(request, response) {
    try {
      const user = request.user;
      const tenant = await TenantManager.getTenant(request.body.id);
      if (!tenant) {
        return TenantController._notFound(response, request.body.id);
      }

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
        "legalDocuments",
      ];

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

      const legalDocumentsError = validateLegalDocumentsField(request.body);
      if (legalDocumentsError) {
        return response.status(400).send(legalDocumentsError);
      }

      // Checked is what the request brings, not what is already stored: a
      // medium that turned `intern` after it was picked must not block the
      // next change to an unrelated field. The scope, on the other hand, is
      // the tenant that was just resolved and checked, never one the payload
      // names.
      await MediaReferenceGuard.assertTenantStorable(
        request.body,
        tenant.id,
        user.id,
      );

      fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(request.body, field)) {
          tenant[field] = request.body[field];
        }
      });

      const previousTenant = await TenantManager.getTenant(request.body.id);
      // Backend-owned access-app state (e.g. Salto IQ activations) is
      // neither written by a tenant update nor sent back in the answer.
      AccessAppLifecycleService.preserveBackendState(previousTenant, tenant);
      await AccessAppLifecycleService.syncWebhooks(previousTenant, tenant);

      const updatedTenant = await TenantManager.storeTenant(tenant);
      logger.info(`updated tenant ${tenant.id} by user ${user?.id}`);
      response
        .status(200)
        .send(
          AccessAppLifecycleService.redactBackendState(
            updatedTenant.exportWithMedia(),
          ),
        );
    } catch (err) {
      // A refused media reference has to reach the admin UI with its code — the
      // blanket 500 below would hide why the save was rejected.
      if (err instanceof BaseError) {
        return response.status(err.statusCode).send(err.toJSON());
      }

      logger.error(err);
      response.status(500).send("could not update tenant");
    }
  }

  static async removeTenant(request, response) {
    try {
      const user = request.user;
      const id = request.params.tenant;

      const tenant = await TenantManager.getTenant(id);
      if (!tenant) {
        return TenantController._notFound(response, id);
      }

      await TenantManager.removeTenant(id);
      logger.info(`removed tenant ${id} by user ${user?.id}`);
      response.sendStatus(200);
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
      const tenantId = request.params.tenant;
      const { templateType, template, pdfBookingLayout, pdfBookingTableMeta } =
        request.body;

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
        params: { tenant: tenantId },
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

      const memberships =
        await MembershipManager.getMembershipsByTenantID(tenantId);

      const userDetails = await UserManager.getUsersById(
        memberships.map((m) => m.userId),
      );

      response.status(200).send({
        users: memberships,
        userDetails: userDetails,
      });
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get users");
    }
  }

  static async addUser(request, response) {
    try {
      const tenantId = request.params.tenant;
      const body = request.body;

      const roles = body.roles;
      const challenges = body.challenges || [];
      const userId = normalizeUserId(body.userId);
      const type = body.type || "manually";

      if (!userId) {
        return response.status(400).send("User ID is required");
      }

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
    } catch (error) {
      logger.error(error);
      response
        .status(error.code || 500)
        .send(error.message || "Could not add user to tenant");
    }
  }

  static async removeUser(request, response, next) {
    try {
      const tenantId = request.params.tenant;
      const { userId } = request.body;

      const targetMembership =
        await MembershipManager.getMembershipByTenantAndUserID(
          tenantId,
          userId,
        );

      // Only an owner removes an owner: the route's `tenantUser.manage` is
      // the user manager's, the target's ownership is the second decision
      // (`tenantUser.owner`, as at `remove-owner`).
      if (
        targetMembership?.owner &&
        decide(request.principal, "tenantUser", "owner") !== "any"
      ) {
        return next(new ForbiddenError());
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
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user from tenant");
    }
  }

  static async removeUserRole(request, response) {
    try {
      const tenantId = request.params.tenant;
      const { userId, roleId } = request.body;
      const user = request.user;

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
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user role from tenant");
    }
  }

  static async editUserRole(request, response) {
    try {
      const tenantId = request.params.tenant;
      const { userId, roles } = request.body;
      const user = request.user;

      const tenantRoles = await RoleManager.getTenantRoles(tenantId);
      const mappedRoles = tenantRoles.map((role) => role.id);

      const verifiedRoles = roles.filter((role) => mappedRoles.includes(role));

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
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove user from tenant");
    }
  }

  static async addOwner(request, response) {
    try {
      const tenantId = request.params.tenant;
      const userId = normalizeUserId(request.body.userId);

      if (!userId) {
        return response.status(400).send("User ID is required");
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
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not add owner to tenant");
    }
  }

  static async removeOwner(request, response) {
    try {
      const tenantId = request.params.tenant;
      const { userId } = request.body;

      const existingMembership =
        await MembershipManager.getMembershipByTenantAndUserID(
          tenantId,
          userId,
        );

      if (!existingMembership || !existingMembership.owner) {
        return response.status(400).send("User is not an owner of the tenant");
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
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not remove owner from tenant");
    }
  }

  static async updateUserStatus(request, response) {
    try {
      const tenantId = request.params.tenant;
      const { userId, status } = request.body;
      const user = request.user;

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
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not update user status in tenant");
    }
  }

  static async updateUserBookingNotificationRecipients(request, response) {
    try {
      const tenantId = request.params.tenant;
      const { userId, bookingNotificationRecipients } = request.body;
      const user = request.user;

      if (!userId) {
        return response.status(400).send("User ID is required");
      }

      const membership = await MembershipManager.getMembershipByTenantAndUserID(
        tenantId,
        userId,
      );

      if (!membership) {
        return response.status(404).send("Membership not found");
      }

      let recipients;
      try {
        recipients =
          await MembershipService.prepareBookingNotificationRecipients(
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
    } catch (error) {
      logger.error(error);
      response
        .status(500)
        .send("Could not update booking notification recipients");
    }
  }

  // The challenges: the right is the router's (`tenant.challenge`, §7.5).
  static async getChallenges(request, response) {
    try {
      const tenantId = request.params.tenant;

      const challenges =
        await ChallengeManager.getChallengesByTenantID(tenantId);
      response.status(200).send(challenges);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get challenges for tenant");
    }
  }

  static async createChallenge(request, response) {
    try {
      const tenantId = request.params.tenant;
      const body = request.body;

      body.id = uuidv4();

      const challenge = await ChallengeManager.createChallenge(tenantId, body);
      response.status(201).send(challenge);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not create challenge for tenant");
    }
  }

  static async updateChallenge(request, response) {
    try {
      const tenantId = request.params.tenant;
      const body = request.body;

      const challenge = await ChallengeManager.updateChallenge(
        tenantId,
        body.id,
        body,
      );
      response.status(200).send(challenge);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not update challenge for tenant");
    }
  }

  static async deleteChallenge(request, response) {
    try {
      const tenantId = request.params.tenant;
      const challengeID = request.params.id;

      await ChallengeManager.deleteChallenge(tenantId, challengeID);
      response.sendStatus(200);
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not delete challenge for tenant");
    }
  }
}

module.exports = { TenantController };
