/**
 * The readiness check (glossary "Bereitschafts-Check", supervision spec §7):
 * a non-binding account of what a tenant still lacks for its public
 * appearance, computed from the current data on every call and never
 * stored. One criterion per rule, each a pure function over data already
 * loaded; `computeReadiness` is the loader in front of them.
 *
 * "Fulfilled" confirms configuration, never that payment or mail actually
 * work: no test mails, no test payments, no reachability tests.
 */

const { NotFoundError } = require("../../../errors/BaseError");
const { Event } = require("../../entities/event/event");
const TenantManager = require("../../data-managers/tenant-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const EventManager = require("../../data-managers/event-manager");
const {
  isCompleteTenantMailConfig,
} = require("../../mail-service/mail-service");

/**
 * The offer types as the supervision constants name them. Ticket 04 creates
 * `supervision-constants.js` in parallel; the merge switches this to its
 * `OFFER_TYPES`.
 */
const OFFER_TYPES = Object.freeze({ BOOKABLE: "bookable", EVENT: "event" });

const STATES = Object.freeze({
  FULFILLED: "fulfilled",
  MISSING: "missing",
  NOT_REQUIRED: "not_required",
});

const CRITERION_KEYS = Object.freeze({
  CONTACT: "contact",
  LEGAL: "legal",
  OFFERS: "offers",
  SCHEDULE: "schedule",
  PAYMENT: "payment",
  MAIL: "mail",
});

/** A formally valid address: something, an `@`, a host with a dot. */
const MAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hasText = (value) => typeof value === "string" && value.trim() !== "";

function criterion(key, state, hint, extra = {}) {
  return { key, state, hint, offers: [], ...extra };
}

/**
 * Contact: name, contact person and a formally valid mail address; phone,
 * website and address are optional (§7).
 */
function contactCriterion(tenant) {
  const missing = [];
  if (!hasText(tenant.name)) missing.push("Name");
  if (!hasText(tenant.contactName)) missing.push("Kontaktperson");
  if (!hasText(tenant.mail) || !MAIL_PATTERN.test(tenant.mail.trim())) {
    missing.push("gültige E-Mail-Adresse");
  }

  if (missing.length === 0) {
    return criterion(
      CRITERION_KEYS.CONTACT,
      STATES.FULFILLED,
      "Name, Kontaktperson und E-Mail-Adresse sind hinterlegt.",
    );
  }
  return criterion(
    CRITERION_KEYS.CONTACT,
    STATES.MISSING,
    `Es fehlt: ${missing.join(", ")}. Telefon, Website und Anschrift sind optional.`,
  );
}

/**
 * Legal documents are optional (§7): a missing text opens no item, and the
 * instance's texts need not be taken over. Listed for completeness.
 */
function legalCriterion() {
  return criterion(
    CRITERION_KEYS.LEGAL,
    STATES.NOT_REQUIRED,
    "Rechtstexte sind optional; ohne eigene Texte gelten die der Instanz.",
  );
}

const asEvent = (record) =>
  record instanceof Event ? record : new Event(record);

const offerRef = (offerType, offer, title) => ({
  offerType,
  offerId: offer.id,
  title,
});

const bookableRef = (bookable) =>
  offerRef(OFFER_TYPES.BOOKABLE, bookable, bookable.title || "");
const eventRef = (event) =>
  offerRef(OFFER_TYPES.EVENT, event, event.information?.name || "");

/**
 * The offers the check looks at (§7): bookables with the publication wish
 * (glossary "Veröffentlichungswunsch"), events with it that are ongoing or
 * still to come. The supervision level and the review status play no
 * part - the check describes preparation, not the gate.
 */
function relevantOffers({ bookables, events, now }) {
  return {
    bookables: (bookables || []).filter(
      (bookable) => bookable.isPublic === true,
    ),
    events: (events || [])
      .filter((event) => event.isPublic === true)
      .map(asEvent)
      .filter((event) => !event.isPast(now)),
  };
}

/** Offers: at least one relevant offer. */
function offersCriterion(relevant) {
  if (relevant.bookables.length + relevant.events.length > 0) {
    return criterion(
      CRITERION_KEYS.OFFERS,
      STATES.FULFILLED,
      "Mindestens ein Angebot mit Veröffentlichungswunsch ist vorhanden.",
    );
  }
  return criterion(
    CRITERION_KEYS.OFFERS,
    STATES.MISSING,
    "Kein Buchungsobjekt und kein laufendes oder künftiges Event ist als öffentlich markiert.",
  );
}

const hasWindow = (entry) =>
  Array.isArray(entry?.weekdays) &&
  entry.weekdays.length > 0 &&
  hasText(entry.startTime) &&
  hasText(entry.endTime);

/**
 * Whether a bookable's time configuration fits its enabled restrictions:
 * an enabled restriction with nothing behind it leaves no time to book.
 * Without restrictions there is nothing to configure; free slots are not
 * asked for (§7).
 */
function hasFittingTimeConfiguration(bookable) {
  if (
    bookable.isOpeningHoursRelated === true &&
    !(bookable.openingHours || []).some(hasWindow)
  ) {
    return false;
  }
  if (
    bookable.isTimePeriodRelated === true &&
    !(bookable.timePeriods || []).some(hasWindow)
  ) {
    return false;
  }
  if (
    bookable.isBlockPeriodRelated === true &&
    (bookable.blockPeriods || []).length === 0
  ) {
    return false;
  }
  return true;
}

/** A valid period: a start that parses, and an end no earlier than it. */
function hasValidPeriod(event) {
  const start = event.getStartDateTime();
  const end = event.getEndDateTime();
  return (
    start instanceof Date &&
    !Number.isNaN(start.getTime()) &&
    end instanceof Date &&
    !Number.isNaN(end.getTime()) &&
    end >= start
  );
}

/** Schedule: every relevant offer has a usable time configuration. */
function scheduleCriterion(relevant) {
  if (relevant.bookables.length + relevant.events.length === 0) {
    return criterion(
      CRITERION_KEYS.SCHEDULE,
      STATES.NOT_REQUIRED,
      "Kein Angebot mit Veröffentlichungswunsch, dessen Zeiten zu prüfen wären.",
    );
  }

  const offers = [
    ...relevant.bookables
      .filter((bookable) => !hasFittingTimeConfiguration(bookable))
      .map(bookableRef),
    ...relevant.events.filter((event) => !hasValidPeriod(event)).map(eventRef),
  ];

  if (offers.length === 0) {
    return criterion(
      CRITERION_KEYS.SCHEDULE,
      STATES.FULFILLED,
      "Alle öffentlichen Angebote haben eine passende Zeitkonfiguration.",
    );
  }
  return criterion(
    CRITERION_KEYS.SCHEDULE,
    STATES.MISSING,
    "Bei diesen Angeboten fehlt ein gültiger Zeitraum oder die aktivierte Zeiteinschränkung hat keine Einträge.",
    { offers },
  );
}

const hasPositivePrice = (priceCategories) =>
  (priceCategories || []).some((category) => Number(category?.priceEur) > 0);

/**
 * Whether a bookable costs money: a price category above zero, or a
 * dynamic external price (`externalProviders` handling `pricing`) - that
 * one is never read as free for lacking a stored price (§7).
 */
function isPaidBookable(bookable) {
  const dynamic = (bookable.externalProviders || []).some(
    (provider) =>
      provider?.active === true && (provider.handles || []).includes("pricing"),
  );
  return dynamic || hasPositivePrice(bookable.priceCategories);
}

/**
 * Whether an event needs the platform's payment: not declared free, not
 * booked elsewhere (`externalBookingUrl`), and priced above zero.
 */
function isPaidPlatformEvent(event) {
  if (hasText(event.externalBookingUrl) || event.attendees?.free === true) {
    return false;
  }
  return hasPositivePrice(event.attendees?.priceCategories);
}

/** The credentials each online payment provider reads from its app. */
const PAYMENT_APP_REQUIRED_FIELDS = Object.freeze({
  giroCockpit: ["paymentMerchantId", "paymentProjectId", "paymentSecret"],
  pmPayment: ["paymentMerchantId", "paymentProjectId", "paymentSecret"],
  ePayBL: [
    "baseUrl",
    "merchantId",
    "managerId",
    "budgetAccount",
    "objectNumber",
    "paymentMethods",
  ],
});

const INVOICE_APP_ID = "invoice";

const isRestricted = (holder) =>
  (holder?.permittedUsers || []).length > 0 ||
  (holder?.permittedRoles || []).length > 0;

/**
 * The active and completely configured payment apps of a tenant. An app
 * the table does not know is taken at its `active` flag - nothing more can
 * be said about it here.
 */
function completePaymentApps(tenant) {
  return (tenant.applications || []).filter((app) => {
    if (app?.type !== "payment" || app.active !== true) {
      return false;
    }
    const required = PAYMENT_APP_REQUIRED_FIELDS[app.id] || [];
    return required.every((field) => Boolean(app[field]));
  });
}

/**
 * Whether the intended booker circle of an offer can pay: any complete
 * online app does; the invoice counts when it is open to everyone, or when
 * the offer itself is limited to a circle the invoice may serve as well.
 */
function isPayableBy(apps, offer) {
  return apps.some(
    (app) =>
      app.id !== INVOICE_APP_ID || !isRestricted(app) || isRestricted(offer),
  );
}

/** Payment: every relevant paid platform offer has a usable payment app. */
function paymentCriterion(tenant, relevant) {
  const paidBookables = relevant.bookables.filter(isPaidBookable);
  const paidEvents = relevant.events.filter(isPaidPlatformEvent);

  if (paidBookables.length + paidEvents.length === 0) {
    return criterion(
      CRITERION_KEYS.PAYMENT,
      STATES.NOT_REQUIRED,
      "Kein kostenpflichtiges Angebot wird über die Plattform abgewickelt.",
    );
  }

  const apps = completePaymentApps(tenant);
  const offers = [
    ...paidBookables
      .filter((bookable) => !isPayableBy(apps, bookable))
      .map(bookableRef),
    ...paidEvents.filter((event) => !isPayableBy(apps, event)).map(eventRef),
  ];

  if (offers.length === 0) {
    return criterion(
      CRITERION_KEYS.PAYMENT,
      STATES.FULFILLED,
      "Für die kostenpflichtigen Angebote ist eine Zahlungsart eingerichtet.",
    );
  }
  return criterion(
    CRITERION_KEYS.PAYMENT,
    STATES.MISSING,
    "Für diese kostenpflichtigen Angebote ist keine vollständig eingerichtete Zahlungsart nutzbar (Rechnung zählt).",
    { offers },
  );
}

/**
 * Mail: the instance has mail switched on, and the transport (glossary
 * "Versandweg") the tenant's mails actually take is complete - the same
 * choice `MailerService.chooseTransport` makes: the instance account for a
 * tenant that uses the instance mail or whose own account is incomplete,
 * the tenant's otherwise. A complete tenant account needs no instance
 * credentials. Only the transport goes out, never a credential.
 */
function mailCriterion(tenant, instance) {
  if (!instance || instance.mailEnabled !== true) {
    return criterion(
      CRITERION_KEYS.MAIL,
      STATES.MISSING,
      "Der Mailversand ist instanzweit deaktiviert.",
      { transport: null },
    );
  }

  const viaTenant =
    tenant.useInstanceMail === false && isCompleteTenantMailConfig(tenant);
  if (viaTenant) {
    return criterion(
      CRITERION_KEYS.MAIL,
      STATES.FULFILLED,
      "Der Versand läuft über das vollständig eingerichtete Mandanten-Postfach.",
      { transport: "tenant" },
    );
  }

  const fallback = tenant.useInstanceMail === false;
  if (isCompleteTenantMailConfig(instance)) {
    return criterion(
      CRITERION_KEYS.MAIL,
      STATES.FULFILLED,
      fallback
        ? "Das Mandanten-Postfach ist unvollständig; der Versand läuft über das Instanz-Postfach."
        : "Der Versand läuft über das Instanz-Postfach.",
      { transport: "instance" },
    );
  }
  return criterion(
    CRITERION_KEYS.MAIL,
    STATES.MISSING,
    fallback
      ? "Weder das Mandanten-Postfach noch das Instanz-Postfach ist vollständig eingerichtet."
      : "Das Instanz-Postfach ist nicht vollständig eingerichtet.",
    { transport: "instance" },
  );
}

/**
 * The criteria over data already loaded.
 *
 * @param {Object} params
 * @param {Object} params.tenant
 * @param {Object|null} params.instance
 * @param {Object[]} params.bookables Every bookable of the tenant
 * @param {Object[]} params.events Every event of the tenant
 * @param {Date} [params.now]
 * @returns {{ checkedAt: string, criteria: Object[] }}
 */
function evaluateReadiness({
  tenant,
  instance,
  bookables,
  events,
  now = new Date(),
}) {
  const relevant = relevantOffers({ bookables, events, now });
  return {
    checkedAt: now.toISOString(),
    criteria: [
      contactCriterion(tenant),
      legalCriterion(),
      offersCriterion(relevant),
      scheduleCriterion(relevant),
      paymentCriterion(tenant, relevant),
      mailCriterion(tenant, instance),
    ],
  };
}

/**
 * Loads what the rules read and evaluates them.
 *
 * @param {string} tenantId
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ checkedAt: string, criteria: Object[] }>}
 * @throws {NotFoundError} For an unknown tenant
 */
async function computeReadiness(tenantId, { now = new Date() } = {}) {
  const tenant = await TenantManager.getTenant(tenantId);
  if (!tenant) {
    throw new NotFoundError("tenant_not_found", { id: tenantId });
  }
  const [instance, bookables, events] = await Promise.all([
    InstanceManager.getInstance(),
    BookableManager.getBookables(tenantId),
    EventManager.getEvents(tenantId),
  ]);
  return evaluateReadiness({ tenant, instance, bookables, events, now });
}

module.exports = {
  computeReadiness,
  evaluateReadiness,
  STATES,
  CRITERION_KEYS,
};
