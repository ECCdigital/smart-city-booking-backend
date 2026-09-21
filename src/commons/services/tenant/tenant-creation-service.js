/**
 * The tenant creation contract (tenant supervision spec §6.1, §6.3): the
 * one place a tenant comes into being, for `POST /api/tenants` and the
 * obsolete `PUT /api/tenants` with an unknown id alike. The right to
 * create (`tenant.create`) is the router's; everything after it is here.
 */

const { readFileSync } = require("fs");
const { join } = require("path");
const { v4: uuidv4 } = require("uuid");
const { isEmail } = require("validator");

const TenantManager = require("../../data-managers/tenant-manager");
const MembershipManager = require("../../data-managers/membership-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const UserManager = require("../../data-managers/user-manager");
const SupervisionHistoryManager = require("../../data-managers/supervision-history-manager");
const SupervisionNotificationManager = require("../../data-managers/supervision-notification-manager");
const Tenant = require("../../entities/tenant/tenant");
const Membership = require("../../entities/tenant/membership");
const {
  mergeDefaultMailSnippets,
} = require("../../mail-service/templates/default-mail-snippets");
const MediaReferenceGuard = require("../media/media-reference-guard");
const { assertVerifiedForSelfService } = require("../user/verification-proof");
const RateLimiter = require("../rate-limit/rate-limiter");
const { tenantSelfCreationPerUser } = require("../rate-limit/limits");
const SupervisionService = require("../supervision/supervision-service");
const {
  SUPERVISION_FIELDS,
  HISTORY_EVENT_TYPES,
  HISTORY_ACTOR_TYPES,
  HISTORY_ORIGINS,
  NOTIFICATION_TYPES,
} = require("../supervision/supervision-constants");
const {
  BadRequestError,
  ConflictError,
  TooManyRequestsError,
} = require("../../../errors/BaseError");

const TEMPLATES = join(__dirname, "../..");
const readTemplate = (relative) =>
  readFileSync(join(TEMPLATES, relative), "utf8");

const isFilled = (value) => typeof value === "string" && value.trim() !== "";

class TenantCreationService {
  /**
   * The required contact of a new tenant (spec §6.1): `name`, `contactName`
   * and a formally valid `mail`; `phone`, `website` and `location` stay
   * optional. Not retroactive - an update of an existing tenant does not
   * pass through here.
   *
   * @param {Object} body
   * @throws {BadRequestError} `missing_name`, `missing_contact_name`,
   *   `invalid_mail` (with `params.field`)
   */
  static assertContact(body) {
    if (!isFilled(body?.name)) {
      throw new BadRequestError("missing_name", { field: "name" });
    }
    if (!isFilled(body?.contactName)) {
      throw new BadRequestError("missing_contact_name", {
        field: "contactName",
      });
    }
    if (!isFilled(body?.mail) || !isEmail(body.mail.trim())) {
      throw new BadRequestError("invalid_mail", { field: "mail" });
    }
  }

  /**
   * Creates a tenant for its first owner.
   *
   * @param {Object} params
   * @param {Object} params.body The request body; supervision fields are dropped
   * @param {string} params.creatorUserId Becomes the tenant owner
   * @param {boolean} params.creatorIsInstanceOwner
   * @param {Object} params.mediaScope The creator's media read scope, for the reference guard
   * @param {Date} [params.now] The creation time; default: now
   * @returns {Promise<Tenant>} The stored tenant
   * @throws {BadRequestError} A missing or invalid contact field (`assertContact`)
   * @throws {ConflictError} `max_tenants_reached`
   * @throws {ForbiddenError} `email_verification_required` for a Selbst-Anlage
   *   without verification proof
   * @throws {TooManyRequestsError} `too_many_requests` with
   *   `params.retryAfterSeconds` when the creator's limit is exhausted
   */
  static async create({
    body,
    creatorUserId,
    creatorIsInstanceOwner,
    mediaScope,
    now = new Date(),
  }) {
    TenantCreationService.assertContact(body);

    const stripped = { ...body };
    for (const field of SUPERVISION_FIELDS) {
      delete stripped[field];
    }
    const tenant = new Tenant(stripped);
    tenant.id = uuidv4();
    tenant.ownerUserIds = [creatorUserId];

    // The global cap holds for everyone, the instance owner included (§6.3).
    if ((await TenantManager.checkTenantCount()) === false) {
      throw new ConflictError("max_tenants_reached");
    }

    // A Selbst-Anlage (glossary) proves the creator's account once more on
    // the server, from the stored user - the request's user carries no
    // verification fields, and signing in alone is no proof (§6.3).
    if (!creatorIsInstanceOwner) {
      assertVerifiedForSelfService(await UserManager.getUser(creatorUserId));
    }

    // A tenant that does not exist yet owns no media, so any medium named
    // here is refused, which beats storing a reference nobody ever checked.
    await MediaReferenceGuard.assertTenantStorable(
      tenant,
      tenant.id,
      mediaScope,
    );

    tenant.genericMailTemplate = readTemplate(
      "mail-service/templates/default-generic-mail-template.temp.html",
    );
    tenant.receiptTemplate = readTemplate(
      "pdf-service/templates/default-receipt-template.temp.html",
    );
    tenant.invoiceTemplate = readTemplate(
      "pdf-service/templates/default-invoice-template.temp.html",
    );
    tenant.mailSnippets = mergeDefaultMailSnippets(tenant.mailSnippets);

    // The level a new tenant starts at is the server's (spec §2): free for
    // the instance owner, the instance's initial level otherwise - never
    // the body's.
    tenant.supervisionLevel = SupervisionService.initialLevelForCreation({
      instance: await InstanceManager.getInstance(),
      creatorIsInstanceOwner,
    });
    tenant.supervisionChangedAt = null;

    const membership = new Membership({
      tenantId: tenant.id,
      userId: creatorUserId,
      roles: [],
      status: "active",
      source: "manually",
      owner: true,
    });

    // The slot is taken before the writes and given back when they fail
    // (§6.3): only a successful self-creation counts, and a deletion later
    // returns nothing. The instance owner is exempt from the time limit.
    const slot = creatorIsInstanceOwner
      ? null
      : await RateLimiter.consume(tenantSelfCreationPerUser(creatorUserId));
    if (slot && !slot.allowed) {
      throw new TooManyRequestsError("too_many_requests", {
        retryAfterSeconds: slot.retryAfterSeconds,
      });
    }

    try {
      await TenantManager.storeTenant(tenant);
      await MembershipManager.addMembership(tenant.id, membership);
      await TenantCreationService._recordCreation({
        tenant,
        creatorUserId,
        selfCreated: !creatorIsInstanceOwner,
        now,
      });
    } catch (error) {
      await TenantCreationService._rollBack(tenant.id, creatorUserId);
      if (slot) await slot.release();
      throw error;
    }
    return tenant;
  }

  /**
   * The history row of the Startstufe (spec §8) for every creation, and the
   * occasion `tenant.selfCreated` for a Selbst-Anlage alone. Both carry a
   * dedupe key on the tenant, so a replay can never write them twice.
   */
  static async _recordCreation({ tenant, creatorUserId, selfCreated, now }) {
    await SupervisionHistoryManager.insert({
      tenantId: tenant.id,
      offerType: null,
      offerId: null,
      eventType: HISTORY_EVENT_TYPES.TENANT_CREATED,
      occurredAt: now,
      actor: { type: HISTORY_ACTOR_TYPES.USER, userId: creatorUserId },
      from: null,
      to: tenant.supervisionLevel,
      reason: null,
      origin: HISTORY_ORIGINS.API,
      dedupeKey: `${HISTORY_EVENT_TYPES.TENANT_CREATED}:${tenant.id}`,
    });
    if (!selfCreated) {
      return;
    }
    await SupervisionNotificationManager.record({
      type: NOTIFICATION_TYPES.TENANT_SELF_CREATED,
      tenantId: tenant.id,
      payload: {
        tenantId: tenant.id,
        tenantName: tenant.name,
        creatorUserId,
        supervisionLevel: tenant.supervisionLevel,
      },
      createdAt: now,
      dedupeKey: `${NOTIFICATION_TYPES.TENANT_SELF_CREATED}:${tenant.id}`,
    });
  }

  /** Removes what a failed creation left, so no half-created tenant stays. */
  static async _rollBack(tenantId, creatorUserId) {
    await Promise.allSettled([
      MembershipManager.removeMembership(tenantId, creatorUserId),
      TenantManager.removeTenant(tenantId),
    ]);
  }
}

module.exports = TenantCreationService;
