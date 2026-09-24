/**
 * The notice types of the tenant supervision (glossary
 * "Aufsichtsmitteilung"; tenant supervision spec §8): central templates of
 * the instance family - the instance's shell template, the instance's
 * transport, no override of a tenant. `ctx` is `{ tenantId, payload }` of
 * the outbox row (glossary "Mitteilungsanlass"), plus `to` for the one
 * named recipient; the sender is `supervision-notification-service.js`.
 */

const {
  SUPERVISION_LEVELS,
  REVIEW_STATUS,
  OFFER_TYPES,
} = require("../services/supervision/supervision-constants");
const {
  REVIEW_ACTIONS,
} = require("../services/supervision/review-transitions");
const { adminDashboardUrl, adminInstanceTenantsUrl } = require("./mail-links");

/** The level as the tenant owner reads it (glossary "Freigabestufe"). */
const LEVEL_LABELS = Object.freeze({
  [SUPERVISION_LEVELS.FREE]: "frei",
  [SUPERVISION_LEVELS.SUPERVISED]: "beaufsichtigt",
  [SUPERVISION_LEVELS.PENDING]: "Freigabe ausstehend",
  [SUPERVISION_LEVELS.DECLINED]: "abgewiesen",
});

// `declined` has no hint yet (its wording comes with its management gate);
// a level without a hint renders none.
const LEVEL_HINTS = Object.freeze({
  [SUPERVISION_LEVELS.FREE]:
    "Ihre Angebote können ohne vorherige Prüfung veröffentlicht werden.",
  [SUPERVISION_LEVELS.SUPERVISED]:
    "Ihre Angebote werden vor der Veröffentlichung von der Plattform geprüft. Reichen Sie ein Angebot zur Prüfung ein, sobald es fertig ist.",
  [SUPERVISION_LEVELS.PENDING]:
    "Ihr Mandant wartet auf die Freigabe durch die Plattform. Sie können bereits alles vorbereiten; Ihre Angebote werden erst nach der Freigabe öffentlich sichtbar und buchbar.",
});

const REVIEW_STATUS_LABELS = Object.freeze({
  [REVIEW_STATUS.PENDING]: "ausstehend",
  [REVIEW_STATUS.APPROVED]: "freigegeben",
  [REVIEW_STATUS.REJECTED]: "abgelehnt",
});

const OFFER_TYPE_LABELS = Object.freeze({
  [OFFER_TYPES.BOOKABLE]: "Buchungsobjekt",
  [OFFER_TYPES.EVENT]: "Veranstaltung",
});

const DECISION_LABELS = Object.freeze({
  [REVIEW_ACTIONS.APPROVE]: "Freigabe",
  [REVIEW_ACTIONS.REJECT]: "Ablehnung",
  [REVIEW_ACTIONS.WITHDRAW]: "Freigaberückzug",
});

const levelLabel = (level) => LEVEL_LABELS[level] ?? String(level ?? "–");
const reviewStatusLabel = (status) =>
  status == null ? "nicht eingereicht" : REVIEW_STATUS_LABELS[status] ?? status;
const offerTypeLabel = (offerType) =>
  OFFER_TYPE_LABELS[offerType] ?? String(offerType ?? "");
const tenantNameOf = ({ tenantId, payload }) => payload.tenantName || tenantId;
const titleOf = (offer) => offer.title || offer.offerId;

const selfCreatedData = (ctx) => ({
  tenantName: tenantNameOf(ctx),
  tenantId: ctx.tenantId,
  creatorUserId: ctx.payload.creatorUserId,
  level: levelLabel(ctx.payload.supervisionLevel),
  levelHint: LEVEL_HINTS[ctx.payload.supervisionLevel] ?? "",
});

const SupervisionMailType = Object.freeze({
  SUPERVISION_TENANT_SELF_CREATED: {
    family: "instance",
    templateName: "supervision-tenant-self-created",
    audience: "instanceOwners",
    subject: (ctx) => `Neuer Mandant angelegt: ${ctx.tenantName}`,
    templateData: (ctx) => ({
      ...selfCreatedData(ctx),
      adminUrl: adminInstanceTenantsUrl(),
    }),
  },

  SUPERVISION_TENANT_CREATION_CONFIRMED: {
    family: "instance",
    templateName: "supervision-tenant-creation-confirmed",
    audience: "named",
    subject: (ctx) => `Ihr Mandant ${ctx.tenantName} wurde angelegt`,
    templateData: (ctx) => ({
      ...selfCreatedData(ctx),
      adminUrl: adminDashboardUrl(),
    }),
  },

  SUPERVISION_REVIEW_QUEUE_ENTERED: {
    family: "instance",
    templateName: "supervision-review-queue-entered",
    audience: "instanceOwners",
    subject: (ctx) =>
      ctx.offers.length === 1
        ? `Neues Angebot zur Prüfung: ${ctx.tenantName}`
        : `${ctx.offers.length} neue Angebote zur Prüfung: ${ctx.tenantName}`,
    templateData: (ctx) => ({
      tenantName: tenantNameOf(ctx),
      offers: (ctx.payload.offers ?? []).map((offer) => ({
        typeLabel: offerTypeLabel(offer.offerType),
        title: titleOf(offer),
        submittedAt: offer.submittedAt,
        isPublic: offer.isPublic === true,
      })),
      adminUrl: adminInstanceTenantsUrl(),
    }),
  },

  SUPERVISION_TENANT_LEVEL_CHANGED: {
    family: "instance",
    templateName: "supervision-tenant-level-changed",
    audience: "tenantOwners",
    subject: (ctx) =>
      `Aufsichtsstufe Ihres Mandanten ${ctx.tenantName} wurde geändert`,
    templateData: (ctx) => ({
      tenantName: tenantNameOf(ctx),
      fromLevel: levelLabel(ctx.payload.from),
      toLevel: levelLabel(ctx.payload.to),
      levelHint: LEVEL_HINTS[ctx.payload.to] ?? "",
      reason: ctx.payload.reason || null,
      adminUrl: adminDashboardUrl(),
    }),
  },

  SUPERVISION_REVIEW_DECIDED: {
    family: "instance",
    templateName: "supervision-review-decided",
    audience: "tenantOwners",
    subject: (ctx) => `${ctx.decision}: ${ctx.typeLabel} „${ctx.title}“`,
    templateData: (ctx) => ({
      tenantName: tenantNameOf(ctx),
      typeLabel: offerTypeLabel(ctx.payload.offerType),
      title: titleOf(ctx.payload),
      decision: DECISION_LABELS[ctx.payload.action] ?? ctx.payload.action,
      fromStatus: reviewStatusLabel(ctx.payload.from),
      toStatus: reviewStatusLabel(ctx.payload.to),
      reason: ctx.payload.reason || null,
      adminUrl: adminDashboardUrl(),
    }),
  },
});

module.exports = { SupervisionMailType };
