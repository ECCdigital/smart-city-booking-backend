const bunyan = require("bunyan");
const { getAccessProvider } = require("./providers/access-provider-registry");
const BookingManager = require("../../data-managers/booking-manager");
const { BookableManager } = require("../../data-managers/bookable-manager");
const PermissionsService = require("../permission-service");
const SecurityUtils = require("../../utilities/security-utils");
const AccessLogService = require("./access-log-service");
const { AccessPointMode } = require("../../entities/access/access-point");
const MailController = require("../../mail-service/mail-controller");

const logger = bunyan.createLogger({
  name: "access-service.js",
  level: process.env.LOG_LEVEL,
});

class AccessService {
  /**
   * Opens an access point linked to a booking.
   */
  static async open(tenant, bookingId, accessPointId, userId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    try {
      const provider = getAccessProvider(accessPoint.provider);
      const result = await provider.open(accessPoint, bookingContext);

      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "open",
        result: "success",
        payload: result,
      });
      return result;
    } catch (err) {
      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "open",
        result: "failure",
        errorMessage: err.message,
      });
      throw err;
    }
  }

  /**
   * Unlatches an access point linked to a booking, i.e. pulls the latch so the
   * door physically opens instead of only releasing the lock.
   */
  static async unlatch(tenant, bookingId, accessPointId, userId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    try {
      const provider = getAccessProvider(accessPoint.provider);
      const result = await provider.unlatch(accessPoint, bookingContext);

      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "unlatch",
        result: "success",
        payload: result,
      });
      return result;
    } catch (err) {
      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "unlatch",
        result: "failure",
        errorMessage: err.message,
      });
      throw err;
    }
  }

  /**
   * Closes an access point linked to a booking.
   */
  static async close(tenant, bookingId, accessPointId, userId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    try {
      const provider = getAccessProvider(accessPoint.provider);
      const result = await provider.close(accessPoint, bookingContext);

      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "close",
        result: "success",
        payload: result,
      });
      return result;
    } catch (err) {
      await this._log({
        tenantId: tenant,
        userId,
        accessPoint,
        bookingId,
        action: "close",
        result: "failure",
        errorMessage: err.message,
      });
      throw err;
    }
  }

  /**
   * Returns the current state of an access point.
   */
  static async getOpenStatus(tenant, bookingId, accessPointId, openProcessId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );
    const provider = getAccessProvider(accessPoint.provider);
    let status;

    let statusSource;

    if (typeof provider.getOpenStatus === "function" && openProcessId) {
      status = await provider.getOpenStatus(tenant, openProcessId);
      statusSource = "open_process";
    } else if (bookingContext.lastEvent) {
      status = {
        confirmed: bookingContext.lastEvent.success === true,
        confirmedAt: bookingContext.lastEvent.timestamp || null,
        event: bookingContext.lastEvent,
      };
      statusSource = "last_event";
    } else {
      status = await provider.getStatus(accessPoint, bookingContext);
      statusSource = "provider_status";
    }

    status = this._normalizeOpenStatus(status, statusSource);

    await this._log({
      tenantId: tenant,
      accessPoint,
      bookingId,
      action: "status",
      result: "success",
      payload: status,
      actor: { source: "system" },
    });
    return status;
  }

  static async getStatus(tenant, bookingId, accessPointId) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    const provider = getAccessProvider(accessPoint.provider);
    const status = this._normalizeOpenStatus(
      await provider.getStatus(accessPoint, bookingContext),
      "provider_status",
    );

    await this._log({
      tenantId: tenant,
      accessPoint,
      bookingId,
      action: "status",
      result: "success",
      payload: status,
      actor: { source: "system" },
    });

    return status;
  }

  static _normalizeOpenStatus(status = {}, statusSource = null) {
    const open = this._resolveOpen(status);

    return {
      ...status,
      open,
      locked: this._resolveLocked(status, open),
      doorOpen: typeof status.doorOpen === "boolean" ? status.doorOpen : null,
      statusSource,
    };
  }

  static _resolveOpen(status) {
    if (typeof status.open === "boolean") {
      return status.open;
    }

    if (typeof status.confirmed === "boolean") {
      return status.confirmed;
    }

    if (status.state === "open" || status.state === "unlocked") {
      return true;
    }

    if (status.state === "closed" || status.state === "locked") {
      return false;
    }

    return null;
  }

  static _resolveLocked(status, open) {
    if (typeof status.locked === "boolean") {
      return status.locked;
    }

    if (status.state === "closed" || status.state === "locked") {
      return true;
    }

    if (open === true) {
      return false;
    }

    return null;
  }

  /**
   * Returns all access points for a booking.
   */
  static async getByBooking(tenant, bookingId) {
    const { lockers, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );

    return [
      ...lockers.map(({ accessPoint, bookingContext }) => ({
        ...accessPoint,
        externalBookingId: bookingContext.externalBookingId,
        lastOpenBoxId: bookingContext.lastOpenBoxId,
        isProvisioned: true,
      })),
      ...doors.map(({ accessPoint, bookingContext }) => ({
        ...accessPoint,
        authorizationId: bookingContext.authorizationId || null,
        isProvisioned: bookingContext.isProvisioned || false,
        provisionedAt: bookingContext.provisionedAt || null,
        lastEvent: bookingContext.lastEvent || null,
        accessBuffer: bookingContext.accessBuffer || { beforeMs: 0, afterMs: 0 },
        accessFrom: bookingContext.accessFrom ?? null,
        accessTo: bookingContext.accessTo ?? null,
      })),
    ];
  }

  static async provisionForBooking(tenant, bookingId) {
    const { booking, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );
    const provisionedAccessPoints = [];

    for (const { accessPoint, bookingContext } of doors) {
      if (!this._usesAuthorization(accessPoint.mode)) {
        continue;
      }

      if (bookingContext.isProvisioned && bookingContext.authorizationId) {
        continue;
      }

      const provider = getAccessProvider(accessPoint.provider);
      const supportedModes = await this._getSupportedModes(
        provider,
        accessPoint,
        tenant,
      );

      if (supportedModes && !supportedModes.includes(accessPoint.mode)) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "failure",
          errorMessage: `Access mode '${accessPoint.mode}' is not supported by access point '${accessPoint.id}'`,
          actor: { source: "system" },
        });
        continue;
      }

      try {
        const result = await provider.grantAuthorization(
          accessPoint,
          bookingContext,
        );

        this._upsertAccessInfo(booking, accessPoint, {
          authorizationId: result.authorizationId,
          pin: result.pin ? SecurityUtils.encrypt(result.pin) : null,
          isProvisioned: true,
          provisionedAt: Date.now(),
          providerResponse: result.providerResponse || null,
        });
        if (result.pin) {
          provisionedAccessPoints.push({
            accessPointId: accessPoint.id,
            label: accessPoint.label || accessPoint.id,
            provider: accessPoint.provider,
            bookableTitle: accessPoint.bookableTitle || "",
            pin: result.pin,
          });
        }

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "success",
          payload: {
            authorizationId: result.authorizationId,
            providerResponse: result.providerResponse || null,
          },
          actor: { source: "system" },
        });
      } catch (err) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "failure",
          errorMessage: err.message,
          actor: { source: "system" },
        });
        throw err;
      }
    }

    await BookingManager.storeBooking(booking);
    await this._sendProvisionedMail(booking, provisionedAccessPoints);
    return booking.accessInfo;
  }

  static async revokeForBooking(tenant, bookingId) {
    const { booking, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );

    await this._revokeResolvedDoors(tenant, booking, doors);
    await BookingManager.storeBooking(booking);
    return booking.accessInfo;
  }

  static async _revokeResolvedDoors(tenant, booking, doors) {
    for (const { accessPoint, bookingContext } of doors) {
      if (!this._usesAuthorization(accessPoint.mode)) {
        continue;
      }

      if (!bookingContext.authorizationId) {
        continue;
      }

      const provider = getAccessProvider(accessPoint.provider);

      try {
        const result = await provider.revokeAuthorization(
          accessPoint,
          bookingContext,
        );

        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: false,
          revokedAt: Date.now(),
          providerResponse: result.providerResponse || null,
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "success",
          payload: {
            authorizationId: bookingContext.authorizationId,
            providerResponse: result.providerResponse || null,
          },
          actor: { source: "system" },
        });
      } catch (err) {
        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "failure",
          errorMessage: err.message,
          actor: { source: "system" },
        });
      }
    }
  }

  static async updateForBooking(tenant, oldBooking, newBooking) {
    const changedTime =
      oldBooking.timeBegin !== newBooking.timeBegin ||
      oldBooking.timeEnd !== newBooking.timeEnd;
    const changedAccessPoints =
      (await this._getDoorAccessPointKey(oldBooking, tenant)) !==
      (await this._getDoorAccessPointKey(newBooking, tenant));

    if (!changedTime && !changedAccessPoints) {
      return newBooking.accessInfo || [];
    }

    const { doors: oldDoors } = await this._getBookingAccessPointsFromBooking(
      tenant,
      oldBooking,
    );
    await this._revokeResolvedDoors(tenant, oldBooking, oldDoors);
    return this.provisionForBooking(tenant, newBooking.id);
  }

  /**
   * Checks whether a user may operate (open/close/status) the access points of
   * a booking.
   *
   * The booking must always be active (committed, paid if priced, not rejected
   * and within its time window) - this applies to everyone, including users
   * with the manage-bookings permission. The permission only replaces the
   * ownership requirement, it does not bypass the booking conditions.
   */
  static async canOperate(
    userId,
    tenant,
    bookingId,
    accessPointId,
    hasManagePermission,
  ) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      return false;
    }

    const { lockers, doors } = await this._getBookingAccessPointsFromBooking(
      tenant,
      booking,
    );

    const resolved = [...lockers, ...doors].find(
      ({ accessPoint }) => String(accessPoint.id) === String(accessPointId),
    );
    const beforeMs = resolved?.bookingContext?.accessBuffer?.beforeMs || 0;
    const afterMs = resolved?.bookingContext?.accessBuffer?.afterMs || 0;

    if (!booking.isWithinAccessWindow(beforeMs, afterMs)) {
      return false;
    }

    if (hasManagePermission) {
      return true;
    }

    return PermissionsService._isOwner(booking, userId, tenant);
  }

  /**
   * Checks whether a user may view (list) the access points assigned to a
   * booking. Unlike {@link canOperate} this does NOT require the booking to
   * be within its (buffered) time window - the assigned access points should
   * be visible at any time as long as the booking is valid (committed, paid
   * if priced, not rejected) and the user is the owner or has the
   * manage-bookings permission.
   */
  static async canView(userId, tenant, bookingId, hasManagePermission) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      return false;
    }

    if (!booking.isBookingValid()) {
      return false;
    }

    if (hasManagePermission) {
      return true;
    }

    return PermissionsService._isOwner(booking, userId, tenant);
  }

  /**
   * @private
   * Resolves access point + builds booking context for the provider.
   */
  static async _resolve(tenant, bookingId, accessPointId) {
    const { lockers, doors } = await this._getBookingAccessPoints(
      tenant,
      bookingId,
    );

    const resolved = [...lockers, ...doors].find(
      ({ accessPoint }) => String(accessPoint.id) === String(accessPointId),
    );

    if (!resolved) {
      throw new Error(
        `Access point ${accessPointId} not found in booking ${bookingId}`,
      );
    }

    return resolved;
  }

  static async _getBookingAccessPoints(tenant, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    return this._getBookingAccessPointsFromBooking(tenant, booking);
  }

  static async _getBookingAccessPointsFromBooking(tenant, booking) {
    const lockers = this._getLockerAccessPoints(tenant, booking);
    const doors = await this._getDoorAccessPoints(tenant, booking);

    return { booking, lockers, doors };
  }

  static _getLockerAccessPoints(tenant, booking) {
    return (booking.lockerInfo || []).map((lockerInfo) => ({
      accessPoint: {
        id: lockerInfo.processId,
        tenant,
        provider: lockerInfo.lockerSystem,
        type: "locker",
      },
      bookingContext: {
        tenant,
        bookingId: booking.id,
        externalBookingId: lockerInfo.processId,
        lastOpenBoxId: lockerInfo.ifbsMetadata?.lastOpenBoxId,
      },
    }));
  }

  /**
   * @private
   * Resolves the access buffer (lead/lag time around a booking) for a given
   * access point. A per access point override
   * (`point.accessBuffer`) takes precedence over the bookable wide default
   * (`accessPointDetails.accessBuffer`). Falls back to no buffer.
   * @returns {{ beforeMs: number, afterMs: number }}
   */
  static _resolveAccessBuffer(bookable, point) {
    const fallback = bookable.accessPointDetails?.accessBuffer || {};
    const override = point.accessBuffer || {};

    const before = Number(override.before ?? fallback.before ?? 0);
    const after = Number(override.after ?? fallback.after ?? 0);

    const toMs = (minutes) =>
      Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 0;

    return { beforeMs: toMs(before), afterMs: toMs(after) };
  }

  static async _getDoorAccessPoints(tenant, booking) {
    const bookableRelations = await this._getBookableRelations(tenant, booking);
    const bookables = await BookableManager.getBookablesByIds(tenant, [
      ...bookableRelations.keys(),
    ]);
    const sortedBookables = this._sortBookablesByRelation(
      bookables,
      bookableRelations,
    );
    const seenAccessPointIds = new Set();

    return sortedBookables.flatMap((bookable) => {
      if (bookable.accessPointDetails?.active !== true) {
        return [];
      }

      return (bookable.accessPointDetails.points || []).flatMap((point) => {
        const accessPointKey = String(point.id);

        if (seenAccessPointIds.has(accessPointKey)) {
          return [];
        }
        seenAccessPointIds.add(accessPointKey);

        const { beforeMs, afterMs } = this._resolveAccessBuffer(
          bookable,
          point,
        );

        const accessInfo = (booking.accessInfo || []).find(
          (info) => String(info.accessPointId) === String(point.id),
        );
        const accessPoint = {
          id: point.id,
          tenant,
          type: "door",
          provider: point.provider,
          externalId: point.externalId,
          locationId: point.locationId || null,
          label: point.label || "",
          mode: point.mode || AccessPointMode.AUTHORIZATION,
          config: point.config || {},
          bookableId: bookable.id,
          bookableTitle: bookable.title,
          relation: bookableRelations.get(bookable.id) || "self",
        };

        return [
          {
            accessPoint,
            bookingContext: {
              tenant,
              bookingId: booking.id,
              timeBegin: booking.timeBegin,
              timeEnd: booking.timeEnd,
              accessBuffer: { beforeMs, afterMs },
              accessFrom: booking.timeBegin - beforeMs,
              accessTo: booking.timeEnd + afterMs,
              booking,
              accessInfo,
              authorizationId: accessInfo?.authorizationId || null,
              isProvisioned: accessInfo?.isProvisioned || false,
              provisionedAt: accessInfo?.provisionedAt || null,
              lastEvent: accessInfo?.lastEvent || null,
            },
          },
        ];
      });
    });
  }

  static _getBookableIds(booking) {
    return [
      ...new Set(
        (booking.bookableItems || [])
          .map((item) => item.bookableId || item._bookableUsed?.id)
          .filter(Boolean),
      ),
    ];
  }

  static async _getBookableRelations(tenant, booking) {
    const directBookableIds = this._getBookableIds(booking);
    const bookableRelations = new Map();

    for (const bookableId of directBookableIds) {
      this._setBookableRelation(bookableRelations, bookableId, "self");
    }

    const inheritChildren =
      process.env.ACCESS_POINTS_INHERIT_CHILDREN !== "false";
    const inheritParents =
      process.env.ACCESS_POINTS_INHERIT_PARENTS !== "false";

    await Promise.all(
      directBookableIds.map(async (bookableId) => {
        if (inheritChildren) {
          const childBookables = await BookableManager.getRelatedBookables(
            bookableId,
            tenant,
          );

          for (const childBookable of childBookables) {
            this._setBookableRelation(
              bookableRelations,
              childBookable.id,
              "child",
            );
          }
        }

        if (inheritParents) {
          const parentBookables = await BookableManager.getAllParentBookables(
            bookableId,
            tenant,
          );

          for (const parentBookable of parentBookables) {
            this._setBookableRelation(
              bookableRelations,
              parentBookable.id,
              "parent",
            );
          }
        }
      }),
    );

    return bookableRelations;
  }

  static _setBookableRelation(bookableRelations, bookableId, relation) {
    const relationPriority = { self: 0, parent: 1, child: 2 };
    const currentRelation = bookableRelations.get(bookableId);

    if (
      !currentRelation ||
      relationPriority[relation] < relationPriority[currentRelation]
    ) {
      bookableRelations.set(bookableId, relation);
    }
  }

  static _sortBookablesByRelation(bookables, bookableRelations) {
    const relationPriority = { self: 0, parent: 1, child: 2 };

    return [...bookables].sort((a, b) => {
      const relationA = bookableRelations.get(a.id) || "self";
      const relationB = bookableRelations.get(b.id) || "self";

      return relationPriority[relationA] - relationPriority[relationB];
    });
  }

  static _usesAuthorization(mode) {
    return (
      mode === AccessPointMode.AUTHORIZATION || mode === AccessPointMode.BOTH
    );
  }

  static async _getSupportedModes(provider, accessPoint, tenant) {
    if (!provider.constructor.capabilities.includes("getSupportedModes")) {
      return null;
    }

    return provider.getSupportedModes(accessPoint, tenant);
  }

  static _upsertAccessInfo(booking, accessPoint, updates) {
    if (!Array.isArray(booking.accessInfo)) {
      booking.accessInfo = [];
    }

    const index = booking.accessInfo.findIndex(
      (info) => String(info.accessPointId) === String(accessPoint.id),
    );
    const existing = index >= 0 ? booking.accessInfo[index] : {};
    const next = {
      ...existing,
      accessPointId: accessPoint.id,
      accessPointType: accessPoint.type,
      provider: accessPoint.provider,
      externalId: accessPoint.externalId,
      mode: accessPoint.mode,
      ...updates,
    };

    if (index >= 0) {
      booking.accessInfo[index] = next;
    } else {
      booking.accessInfo.push(next);
    }
  }

  static async _getDoorAccessPointKey(booking, tenant) {
    const doors = await this._getDoorAccessPoints(tenant, booking);
    return doors
      .map(({ accessPoint }) =>
        [
          accessPoint.id,
          accessPoint.provider,
          accessPoint.externalId,
          accessPoint.mode,
        ].join(":"),
      )
      .sort()
      .join("|");
  }

  static async _sendProvisionedMail(booking, provisionedAccessPoints) {
    if (!provisionedAccessPoints.length || !booking.mail) {
      return;
    }

    try {
      await MailController.sendAccessProvisioned(
        booking.mail,
        booking.id,
        booking.tenantId,
        provisionedAccessPoints,
      );
    } catch (err) {
      logger.error(
        `${booking.tenantId} -- failed to send access provisioned mail for booking ${booking.id}: ${err.message}`,
      );
    }
  }

  /** @private */
  static async _log({
    tenantId,
    userId,
    accessPoint,
    bookingId,
    action,
    result = "pending",
    payload = {},
    errorMessage = null,
    actor = null,
  }) {
    logger.info(
      `${tenantId} -- ${action} ${result} on access-point ${accessPoint.id} (booking ${bookingId})`,
    );

    try {
      await AccessLogService.log({
        tenantId,
        bookingId,
        accessPointId: accessPoint.id,
        accessPointType: accessPoint.type,
        provider: accessPoint.provider,
        externalId: accessPoint.externalId || null,
        action,
        actor: actor || { userId, source: userId ? "user" : "system" },
        result,
        payload,
        errorMessage,
      });
    } catch (err) {
      logger.error(`Failed to write access log: ${err.message}`);
    }
  }
}

module.exports = AccessService;
