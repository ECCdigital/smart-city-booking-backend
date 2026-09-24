const bunyan = require("bunyan");
const SupervisionNotificationManager = require("../../data-managers/supervision-notification-manager");
const InstanceManager = require("../../data-managers/instance-manager");
const { compose, send } = require("../../mail-service");
const { ConflictError, NotFoundError } = require("../../../errors/BaseError");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUS,
} = require("./supervision-constants");

const logger = bunyan.createLogger({
  name: "supervision-notification-service.js",
  level: process.env.LOG_LEVEL,
});

/**
 * How long a dispatch holds its row. The transport gives up after three
 * attempts within seconds; a lease older than this belongs to a process
 * that is gone, and the row may be dispatched again.
 */
const DISPATCH_LEASE_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

/** The secrets of the instance's no-reply account, never to be stored. */
const SECRET_FIELDS = ["noreplyPassword", "noreplyGraphClientSecret"];

/** The dispatches under way; `whenIdle` lets a test wait for them. */
const inFlight = new Set();

/**
 * The notices of an occasion: which central templates go out for a row.
 * The recipients are the template's audience - the instance owners, the
 * tenant's owners - except for the confirmation of a self-creation, which
 * goes to the one who created the tenant.
 */
function noticesOf(row) {
  const ctx = { tenantId: row.tenantId, payload: row.payload ?? {} };
  switch (row.type) {
    case NOTIFICATION_TYPES.TENANT_SELF_CREATED:
      return [
        { mailType: "SUPERVISION_TENANT_SELF_CREATED", ctx },
        {
          mailType: "SUPERVISION_TENANT_CREATION_CONFIRMED",
          ctx: { ...ctx, to: ctx.payload.creatorUserId },
        },
      ];
    case NOTIFICATION_TYPES.REVIEW_QUEUE_ENTERED:
      return [{ mailType: "SUPERVISION_REVIEW_QUEUE_ENTERED", ctx }];
    case NOTIFICATION_TYPES.TENANT_LEVEL_CHANGED:
      return [{ mailType: "SUPERVISION_TENANT_LEVEL_CHANGED", ctx }];
    case NOTIFICATION_TYPES.REVIEW_DECIDED:
      return [{ mailType: "SUPERVISION_REVIEW_DECIDED", ctx }];
    default:
      throw new Error(`unknown notification type ${row.type}`);
  }
}

/** The delivery of one mail of a row: which notice, to whom. */
const deliveryKey = (mailType, to) => `${mailType} ${to}`;

/**
 * The message of an error - never the error itself - with the secrets of
 * the instance's no-reply account masked, bounded.
 */
function safeMessage(error, instance) {
  let message = String(error?.message ?? error);
  for (const field of SECRET_FIELDS) {
    const secret = instance?.[field];
    if (typeof secret === "string" && secret.length > 0) {
      message = message.split(secret).join("***");
    }
  }
  return message.slice(0, MAX_ERROR_LENGTH);
}

/**
 * The sender of the supervision notification outbox (glossary
 * "Aufsichtsmitteilung"; tenant supervision spec §8). An occasion is
 * recorded first and dispatched right after, detached from the business
 * action: what fails stays on the row (`failed`, `lastError`) and is
 * dispatched again by the instance owner, without a new decision and
 * without new history.
 *
 * Delivery guarantee: every mail of a row that went out is kept on the row
 * (`deliveries`), so a retry only mails who is still missing; a row is
 * `sent` once nobody is. Two dispatches of the same row never run at the
 * same time (the manager's claim). A crash between the transport accepting
 * a mail and the delivery being kept can repeat that one mail - at least
 * once, never silently none.
 */
class SupervisionNotificationService {
  /**
   * Records an occasion and dispatches it, fire-and-forget. The one place
   * every supervision occasion goes through. A failing record is the
   * caller's to handle, as before; a repeated `dedupeKey` fails there, so
   * nothing is ever dispatched twice for it. The dispatch never throws
   * into the caller.
   *
   * @param {Object} occasion The occasion of `SupervisionNotificationManager.record`
   * @returns {Promise<Object>} The recorded row
   */
  static async recordAndDispatch(occasion) {
    const row = await SupervisionNotificationManager.record(occasion);
    if (row?.id) {
      const dispatching = SupervisionNotificationService.dispatch(row.id)
        .catch((error) => {
          logger.error(
            { err: error, notificationId: row.id },
            "supervision notification dispatch failed unexpectedly",
          );
        })
        .finally(() => inFlight.delete(dispatching));
      inFlight.add(dispatching);
    }
    return row;
  }

  /** Resolves once every dispatch under way has settled. */
  static async whenIdle() {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight]);
    }
  }

  /**
   * Sends the mails of one outbox row that are still missing and marks it
   * `sent`, or `failed` with the reason.
   *
   * @param {string} notificationId
   * @returns {Promise<Object|null>} The row after the dispatch; null when
   *   there was nothing to do - unknown, already sent, or being dispatched
   *   (also by a later dispatch, where this one outlived its lease)
   */
  static async dispatch(notificationId) {
    const row = await SupervisionNotificationManager.claimForDispatch(
      notificationId,
      { now: new Date(), leaseMs: DISPATCH_LEASE_MS },
    );
    if (!row) {
      return null;
    }

    let instance = null;
    try {
      instance = await InstanceManager.getInstance();
      if (instance?.mailEnabled === false) {
        throw new Error("mail_disabled: the instance's mail is switched off");
      }

      const deliveries = row.deliveries ?? [];
      const delivered = new Set(
        deliveries.map(({ mailType, to }) => deliveryKey(mailType, to)),
      );
      const errors = [];

      for (const { mailType, ctx } of noticesOf(row)) {
        const mails = await compose(mailType, ctx);
        // Every notice of the occasion needs somebody: a self-creation
        // confirmed to the creator alone has not told the instance owners.
        if (
          mails.length === 0 &&
          !deliveries.some((delivery) => delivery.mailType === mailType)
        ) {
          errors.push(`no_recipients: nobody to tell for ${mailType}`);
        }
        for (const mail of mails) {
          if (delivered.has(deliveryKey(mailType, mail.to))) {
            continue;
          }
          try {
            // Always the instance's transport, whatever the tenant's own
            // mail configuration says: no tenant on the mail.
            const outcome = await send({ ...mail, tenantId: null });
            if (outcome.status !== "sent") {
              throw new Error(`mail_${outcome.status}: ${outcome.reason}`);
            }
            await SupervisionNotificationManager.markDelivered(row.id, {
              mailType,
              to: mail.to,
              deliveredAt: new Date(),
            });
          } catch (error) {
            errors.push(`${mail.to}: ${safeMessage(error, instance)}`);
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }
      return await SupervisionNotificationManager.markSent(row.id, {
        lease: row.dispatchingSince,
        sentAt: new Date(),
      });
    } catch (error) {
      const lastError = safeMessage(error, instance);
      logger.warn(
        { notificationId: row.id, type: row.type, tenantId: row.tenantId },
        `supervision notification not sent: ${lastError}`,
      );
      return SupervisionNotificationManager.markFailed(row.id, {
        lease: row.dispatchingSince,
        lastError,
      });
    }
  }

  /**
   * Dispatches a row again that is not sent yet. Never touches a decision
   * or the history - only the mails still missing go out.
   *
   * @param {string} notificationId
   * @returns {Promise<Object>} The row after the dispatch (`sent` or `failed`)
   * @throws {NotFoundError} For an unknown row
   * @throws {ConflictError} For a row already sent, or being dispatched
   */
  static async retry(notificationId) {
    const row = await SupervisionNotificationManager.get(notificationId);
    if (!row) {
      throw new NotFoundError("supervision_notification_not_found", {
        id: notificationId,
      });
    }
    if (row.status === NOTIFICATION_STATUS.SENT) {
      throw new ConflictError("supervision_notification_already_sent", {
        id: notificationId,
      });
    }
    const dispatched =
      await SupervisionNotificationService.dispatch(notificationId);
    if (!dispatched) {
      throw new ConflictError("supervision_notification_dispatch_in_progress", {
        id: notificationId,
      });
    }
    return dispatched;
  }
}

module.exports = SupervisionNotificationService;
