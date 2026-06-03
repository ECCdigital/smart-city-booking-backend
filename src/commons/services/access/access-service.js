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

    if (typeof provider.getOpenStatus === "function" && openProcessId) {
      status = await provider.getOpenStatus(tenant, openProcessId);
    } else if (bookingContext.lastEvent) {
      status = {
        confirmed: bookingContext.lastEvent.success === true,
        confirmedAt: bookingContext.lastEvent.timestamp || null,
        event: bookingContext.lastEvent,
      };
    } else {
      status = await provider.getStatus(accessPoint, bookingContext);
    }

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
    const status = await provider.getStatus(accessPoint, bookingContext);

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
   * Checks if user owns the booking and it's currently active.
   */
  static async isBookingOwnerAndActive(userId, tenant, bookingId) {
    const booking = await BookingManager.getBooking(bookingId, tenant);

    const isActive = booking.getIsActive();

    const hasPermission = PermissionsService._isOwner(booking, userId, tenant);

    return hasPermission && isActive;
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

  static async _getDoorAccessPoints(tenant, booking) {
    const bookableIds = this._getBookableIds(booking);
    const bookables = await BookableManager.getBookablesByIds(
      tenant,
      bookableIds,
    );

    return bookables.flatMap((bookable) => {
      if (bookable.accessPointDetails?.active !== true) {
        return [];
      }

      return (bookable.accessPointDetails.points || []).map((point) => {
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
        };

        return {
          accessPoint,
          bookingContext: {
            tenant,
            bookingId: booking.id,
            timeBegin: booking.timeBegin,
            timeEnd: booking.timeEnd,
            booking,
            accessInfo,
            authorizationId: accessInfo?.authorizationId || null,
            isProvisioned: accessInfo?.isProvisioned || false,
            provisionedAt: accessInfo?.provisionedAt || null,
            lastEvent: accessInfo?.lastEvent || null,
          },
        };
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

  static _usesAuthorization(mode) {
    return (
      mode === AccessPointMode.AUTHORIZATION || mode === AccessPointMode.BOTH
    );
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
