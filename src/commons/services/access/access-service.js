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
  static async open(tenant, bookingId, accessPointId, userId, options = {}) {
    const { accessPoint, bookingContext } = await this._resolve(
      tenant,
      bookingId,
      accessPointId,
    );

    try {
      const provider = getAccessProvider(accessPoint.provider);
      const result = await provider.open(accessPoint, {
        ...bookingContext,
        openOptions: {
          otp: options.otp || null,
        },
      });

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
        accessBuffer: bookingContext.accessBuffer || {
          beforeMs: 0,
          afterMs: 0,
        },
        accessFrom: bookingContext.accessFrom ?? null,
        accessTo: bookingContext.accessTo ?? null,
      })),
      ...doors.map(({ accessPoint, bookingContext }) => ({
        ...accessPoint,
        authorizationId: bookingContext.authorizationId || null,
        accessId: bookingContext.accessId || null,
        saltoUserId: bookingContext.saltoUserId || null,
        isProvisioned: bookingContext.isProvisioned || false,
        provisionedAt: bookingContext.provisionedAt || null,
        lastEvent: bookingContext.lastEvent || null,
        accessBuffer: bookingContext.accessBuffer || {
          beforeMs: 0,
          afterMs: 0,
        },
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
      if (accessPoint.mode === AccessPointMode.REMOTE) {
        if (bookingContext.isProvisioned) {
          continue;
        }

        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: true,
          provisionedAt: Date.now(),
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId,
          action: "provision",
          result: "success",
          payload: { mode: AccessPointMode.REMOTE },
          actor: { source: "system" },
        });
        continue;
      }

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
          accessId: result.accessId || result.authorizationId || null,
          saltoUserId: result.saltoUserId || null,
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
            accessId: result.accessId || null,
            saltoUserId: result.saltoUserId || null,
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
      if (accessPoint.mode === AccessPointMode.REMOTE) {
        if (!bookingContext.isProvisioned) {
          continue;
        }

        this._upsertAccessInfo(booking, accessPoint, {
          isProvisioned: false,
          revokedAt: Date.now(),
        });

        await this._log({
          tenantId: tenant,
          accessPoint,
          bookingId: booking.id,
          action: "revoke",
          result: "success",
          payload: { mode: AccessPointMode.REMOTE },
          actor: { source: "system" },
        });
        continue;
      }

      if (!this._usesAuthorization(accessPoint.mode)) {
        continue;
      }

      if (
        !bookingContext.authorizationId &&
        !bookingContext.accessId &&
        !bookingContext.saltoUserId
      ) {
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
          saltoUserDeletedAt:
            result.userDeleted === true
              ? Date.now()
              : bookingContext.saltoUserDeletedAt || null,
          saltoUserCleanupError:
            result.userDeleted === false
              ? result.providerResponse?.userDeleteError ||
                "Failed to delete Salto KS user"
              : null,
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
            accessId: bookingContext.accessId || null,
            saltoUserId: bookingContext.saltoUserId || null,
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
   * Returns all bookings of a user that grant any access authorization
   * i.e. that resolve to at least one door access point
   * (and, if requested, locker access points).
   *
   * Tenant-independent: a user may have bookings across several tenants. The
   * user's committed bookings are loaded once (narrowed by status/time) and the
   * access point inheritance is resolved per tenant via a trigger map.
   *
   * @param {string} userId Assigned user ID
   * @param {Object} [opts]
   * @param {string} [opts.state="all"] One of "active" | "upcoming" | "past" | "all"
   * @param {string|null} [opts.capability=null] "authorization" to restrict to provisioned authorizations
   * @param {boolean} [opts.includeAccessPoints=false] Attach the full access point list per booking
   * @param {boolean} [opts.includeLockers=false] Treat locker access points as an authorization too
   * @param {boolean} [opts.includeBuffer=false] Honor the access buffer for state="active"
   * @param {number} [opts.now=Date.now()] Reference timestamp
   * @returns {Promise<Object[]>} Matching bookings (sensitive data stripped)
   */
  static async getUserBookingsWithAccess(
    userId,
    {
      state = "all",
      capability = null,
      includeAccessPoints = false,
      includeLockers = false,
      includeBuffer = false,
      now = Date.now(),
    } = {},
  ) {
    const timeFilter = this._buildTimeFilter(state, now, includeBuffer);
    const bookings = await BookingManager.getUserBookingsFiltered(
      null,
      userId,
      {
        timeFilter,
      },
    );

    if (!bookings.length) {
      return [];
    }

    const triggerMaps = await this._getAccessTriggerMapsForTenants(
      this._uniqueTenantIds(bookings),
    );

    return this._buildAccessBookingResults(bookings, {
      state,
      capability,
      includeAccessPoints,
      includeLockers,
      includeBuffer,
      now,
      resolve: (booking) =>
        this._resolveBookingAccess(
          booking,
          triggerMaps.get(booking.tenantId) || new Map(),
          { capability, includeLockers },
        ),
    });
  }

  /**
   * Returns all bookings of a user that grant an access authorization for a
   * specific access point. The access point may be a door (resolved via the
   * bookables) or, when `includeLockers` is set, a locker (matched via
   * `booking.lockerInfo[].processId`).
   *
   * Tenant-independent: trigger ids for the access point are resolved per
   * tenant the user has bookings in.
   *
   * @param {string} userId Assigned user ID
   * @param {string} accessPointId Access point ID
   * @param {Object} [opts] See {@link getUserBookingsWithAccess}
   * @returns {Promise<Object[]>} Matching bookings (sensitive data stripped)
   */
  static async getUserBookingsForAccessPoint(
    userId,
    accessPointId,
    {
      state = "all",
      capability = null,
      includeAccessPoints = false,
      includeLockers = false,
      includeBuffer = false,
      now = Date.now(),
    } = {},
  ) {
    const timeFilter = this._buildTimeFilter(state, now, includeBuffer);
    const bookings = await BookingManager.getUserBookingsFiltered(
      null,
      userId,
      {
        timeFilter,
      },
    );

    if (!bookings.length) {
      return [];
    }

    const tenantIds = this._uniqueTenantIds(bookings);
    const triggerByTenant = new Map();
    await Promise.all(
      tenantIds.map(async (tenantId) => {
        triggerByTenant.set(
          tenantId,
          await this._getTriggerBookableIdsForAccessPoint(
            tenantId,
            accessPointId,
          ),
        );
      }),
    );

    return this._buildAccessBookingResults(bookings, {
      state,
      capability,
      includeAccessPoints,
      includeLockers,
      includeBuffer,
      now,
      resolve: (booking) => {
        const { triggerIds, mode } = triggerByTenant.get(booking.tenantId) || {
          triggerIds: new Set(),
          mode: null,
        };
        return this._resolveBookingAccessForPoint(
          booking,
          accessPointId,
          mode,
          { triggerIds, capability, includeLockers },
        );
      },
    });
  }

  /**
   * @private
   * Builds one trigger map per tenant.
   * @returns {Promise<Map<string, Map<string, Map<string, string>>>>}
   */
  static async _getAccessTriggerMapsForTenants(tenantIds) {
    const entries = await Promise.all(
      tenantIds.map(async (tenantId) => [
        tenantId,
        await this._getAccessTriggerMap(tenantId),
      ]),
    );
    return new Map(entries);
  }

  /** @private */
  static _uniqueTenantIds(bookings) {
    return [...new Set(bookings.map((booking) => booking.tenantId))];
  }

  /**
   * @private
   * Shared post-processing: applies the per-booking access resolution, the
   * state/validity filter and (optionally) enriches with the full access point
   * list. Returns plain, sensitive-data-free result objects.
   */
  static async _buildAccessBookingResults(
    bookings,
    {
      state,
      capability,
      includeAccessPoints,
      includeLockers,
      includeBuffer,
      now,
      resolve,
    },
  ) {
    const matched = [];

    for (const booking of bookings) {
      if (!booking.isBookingValid()) {
        continue;
      }

      const resolved = resolve(booking);
      if (!resolved || !resolved.accessPointIds.length) {
        continue;
      }

      const needsEnrichment =
        includeAccessPoints || (state === "active" && includeBuffer);
      let enrichedPoints = null;
      if (needsEnrichment) {
        enrichedPoints = await this._getFilteredBookingAccessPoints(
          booking.tenantId,
          booking.id,
          { capability, includeLockers },
        );
      }

      if (
        !this._matchesState(booking, state, now, includeBuffer, enrichedPoints)
      ) {
        continue;
      }

      const result = {
        id: booking.id,
        tenantId: booking.tenantId,
        assignedUserId: booking.assignedUserId,
        timeBegin: booking.timeBegin,
        timeEnd: booking.timeEnd,
        isCommitted: booking.isCommitted,
        isPayed: booking.isPayed,
        isRejected: booking.isRejected,
        priceEur: booking.priceEur,
        state: this._deriveState(booking, now),
        accessPointIds: resolved.accessPointIds,
      };

      if (includeAccessPoints) {
        result.accessPoints = enrichedPoints;
      }

      matched.push({ result, booking });
    }

    await this._attachLeadBookables(matched);

    const results = matched.map(({ result }) => result);

    return this._sortResults(results, state);
  }

  /**
   * @private
   * Attaches the `leadBookable` (id, title, location) of each booking's first
   * booked item to its result. Lead bookables are batch-loaded per tenant to
   * avoid N+1 queries.
   */
  static async _attachLeadBookables(matched) {
    const idsByTenant = new Map();
    for (const { booking } of matched) {
      const leadId = this._getLeadBookableId(booking);
      if (!leadId) {
        continue;
      }
      let ids = idsByTenant.get(booking.tenantId);
      if (!ids) {
        ids = new Set();
        idsByTenant.set(booking.tenantId, ids);
      }
      ids.add(leadId);
    }

    const bookableByKey = new Map();
    await Promise.all(
      [...idsByTenant.entries()].map(async ([tenantId, ids]) => {
        const bookables = await BookableManager.getBookablesByIds(tenantId, [
          ...ids,
        ]);
        for (const bookable of bookables) {
          bookableByKey.set(`${tenantId}:${bookable.id}`, bookable);
        }
      }),
    );

    for (const { result, booking } of matched) {
      const leadId = this._getLeadBookableId(booking);
      const bookable = leadId
        ? bookableByKey.get(`${booking.tenantId}:${leadId}`)
        : null;

      result.leadBookable = bookable
        ? {
            id: bookable.id,
            title: bookable.title,
            location: bookable.location,
          }
        : null;
    }
  }

  /**
   * @private
   * Returns the bookable id of the first item booked in a booking, or null.
   */
  static _getLeadBookableId(booking) {
    const firstItem = (booking.bookableItems || [])[0];
    if (!firstItem) {
      return null;
    }
    return firstItem.bookableId || firstItem._bookableUsed?.id || null;
  }

  /**
   * @private
   * Builds the trigger map for a tenant: a map from a directly bookable id to
   * the access points that a booking referencing it would inherit. The map
   * keys are exactly the bookable ids that confer an access authorization.
   *
   * Inheritance mirrors {@link _getBookableRelations} but inverted: for each
   * bookable X with active access points, a booking confers X's points if it
   * directly references X, an ancestor of X (when children are inherited) or a
   * descendant of X (when parents are inherited).
   *
   * @returns {Promise<Map<string, Map<string, string>>>} bookableId -> (accessPointId -> mode)
   */
  static async _getAccessTriggerMap(tenant) {
    const apBookables =
      await BookableManager.getBookablesWithAccessPoints(tenant);

    const inheritChildren =
      process.env.ACCESS_POINTS_INHERIT_CHILDREN !== "false";
    const inheritParents =
      process.env.ACCESS_POINTS_INHERIT_PARENTS !== "false";

    const map = new Map();
    const addPoints = (bookableId, points) => {
      let pointMap = map.get(bookableId);
      if (!pointMap) {
        pointMap = new Map();
        map.set(bookableId, pointMap);
      }
      for (const point of points) {
        pointMap.set(
          String(point.id),
          point.mode || AccessPointMode.AUTHORIZATION,
        );
      }
    };

    await Promise.all(
      apBookables.map(async (bookable) => {
        const points = bookable.accessPointDetails?.points || [];
        if (!points.length) {
          return;
        }

        addPoints(bookable.id, points);

        const relatedLookups = [];
        if (inheritChildren) {
          relatedLookups.push(
            BookableManager.getAllParentBookables(bookable.id, tenant),
          );
        }
        if (inheritParents) {
          relatedLookups.push(
            BookableManager.getRelatedBookables(bookable.id, tenant),
          );
        }

        const relatedGroups = await Promise.all(relatedLookups);
        for (const group of relatedGroups) {
          for (const related of group) {
            addPoints(related.id, points);
          }
        }
      }),
    );

    return map;
  }

  /**
   * @private
   * Resolves the set of directly bookable ids whose booking would confer the
   * given access point, plus the access point's mode.
   * @returns {Promise<{ triggerIds: Set<string>, mode: string|null }>}
   */
  static async _getTriggerBookableIdsForAccessPoint(tenant, accessPointId) {
    const apBookables = await BookableManager.getBookablesByAccessPointId(
      tenant,
      accessPointId,
    );

    const inheritChildren =
      process.env.ACCESS_POINTS_INHERIT_CHILDREN !== "false";
    const inheritParents =
      process.env.ACCESS_POINTS_INHERIT_PARENTS !== "false";

    const triggerIds = new Set();
    let mode = null;

    await Promise.all(
      apBookables.map(async (bookable) => {
        const point = (bookable.accessPointDetails?.points || []).find(
          (p) => String(p.id) === String(accessPointId),
        );
        if (point) {
          mode = point.mode || AccessPointMode.AUTHORIZATION;
        }

        triggerIds.add(bookable.id);

        const relatedLookups = [];
        if (inheritChildren) {
          relatedLookups.push(
            BookableManager.getAllParentBookables(bookable.id, tenant),
          );
        }
        if (inheritParents) {
          relatedLookups.push(
            BookableManager.getRelatedBookables(bookable.id, tenant),
          );
        }

        const relatedGroups = await Promise.all(relatedLookups);
        for (const group of relatedGroups) {
          for (const related of group) {
            triggerIds.add(related.id);
          }
        }
      }),
    );

    return { triggerIds, mode };
  }

  /**
   * @private
   * Resolves which access point ids a booking confers, using the precomputed
   * trigger map. Honors the `capability` and `includeLockers` options.
   */
  static _resolveBookingAccess(
    booking,
    triggerMap,
    { capability, includeLockers },
  ) {
    const directIds = this._getBookableIds(booking);
    const onlyAuthorization = capability === "authorization";
    const seen = new Set();
    const accessPointIds = [];

    for (const bookableId of directIds) {
      const pointMap = triggerMap.get(bookableId);
      if (!pointMap) {
        continue;
      }

      for (const [accessPointId, mode] of pointMap) {
        if (seen.has(accessPointId)) {
          continue;
        }
        if (onlyAuthorization && !this._usesAuthorization(mode)) {
          continue;
        }
        seen.add(accessPointId);
        accessPointIds.push(accessPointId);
      }
    }

    if (includeLockers && !onlyAuthorization) {
      for (const lockerInfo of booking.lockerInfo || []) {
        const lockerId = lockerInfo.processId;
        if (lockerId && !seen.has(String(lockerId))) {
          seen.add(String(lockerId));
          accessPointIds.push(String(lockerId));
        }
      }
    }

    return { accessPointIds };
  }

  /**
   * @private
   * Resolves whether a booking confers a single, specific access point.
   */
  static _resolveBookingAccessForPoint(
    booking,
    accessPointId,
    mode,
    { triggerIds, capability, includeLockers },
  ) {
    const onlyAuthorization = capability === "authorization";
    const targetId = String(accessPointId);

    const directIds = this._getBookableIds(booking);
    const matchesDoor =
      triggerIds.size > 0 &&
      directIds.some((id) => triggerIds.has(id)) &&
      !(onlyAuthorization && !this._usesAuthorization(mode));

    const matchesLocker =
      includeLockers &&
      !onlyAuthorization &&
      (booking.lockerInfo || []).some(
        (info) => String(info.processId) === targetId,
      );

    if (!matchesDoor && !matchesLocker) {
      return { accessPointIds: [] };
    }

    return { accessPointIds: [targetId] };
  }

  /**
   * @private
   * Loads the access points of a booking and applies the capability/locker
   * filters. Reuses {@link getByBooking} (which never exposes PINs).
   */
  static async _getFilteredBookingAccessPoints(
    tenant,
    bookingId,
    { capability, includeLockers },
  ) {
    const points = await this.getByBooking(tenant, bookingId);
    const onlyAuthorization = capability === "authorization";

    return points.filter((point) => {
      if (point.type === "locker") {
        return includeLockers && !onlyAuthorization;
      }
      if (onlyAuthorization) {
        return this._usesAuthorization(point.mode);
      }
      return true;
    });
  }

  /**
   * @private
   * Builds the database time filter for a state. Returns `{}` when the filter
   * cannot be safely expressed at the database level (active + buffer).
   */
  static _buildTimeFilter(state, now, includeBuffer) {
    switch (state) {
      case "active":
        if (includeBuffer) {
          return {};
        }
        return { timeBegin: { $lte: now }, timeEnd: { $gte: now } };
      case "upcoming":
        return { timeBegin: { $gt: now } };
      case "past":
        return { timeEnd: { $lt: now } };
      default:
        return {};
    }
  }

  /**
   * @private
   * In-memory state check (the database filter is only an optimization).
   */
  static _matchesState(booking, state, now, includeBuffer, enrichedPoints) {
    switch (state) {
      case "active":
        if (includeBuffer) {
          const { beforeMs, afterMs } = this._maxBuffer(enrichedPoints);
          return booking.isWithinAccessWindow(beforeMs, afterMs, now);
        }
        return booking.timeBegin <= now && booking.timeEnd >= now;
      case "upcoming":
        return booking.timeBegin > now;
      case "past":
        return booking.timeEnd < now;
      default:
        return true;
    }
  }

  /**
   * @private
   * Largest access buffer across a booking's resolved door access points.
   */
  static _maxBuffer(enrichedPoints) {
    let beforeMs = 0;
    let afterMs = 0;
    for (const point of enrichedPoints || []) {
      const buffer = point.accessBuffer || {};
      beforeMs = Math.max(beforeMs, buffer.beforeMs || 0);
      afterMs = Math.max(afterMs, buffer.afterMs || 0);
    }
    return { beforeMs, afterMs };
  }

  /**
   * @private
   */
  static _deriveState(booking, now) {
    if (booking.timeBegin <= now && booking.timeEnd >= now) {
      return "active";
    }
    if (booking.timeBegin > now) {
      return "upcoming";
    }
    return "past";
  }

  /**
   * @private
   * Default sort: upcoming/active ascending by start, past descending.
   */
  static _sortResults(results, state) {
    const descending = state === "past";
    return results.sort((a, b) =>
      descending ? b.timeBegin - a.timeBegin : a.timeBegin - b.timeBegin,
    );
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
    const beforeMs = 0;
    const afterMs = 0;

    return (booking.lockerInfo || []).map((lockerInfo) => ({
      accessPoint: {
        id: lockerInfo.processId,
        tenant,
        provider: lockerInfo.lockerSystem,
        type: "locker",
        mode: AccessPointMode.REMOTE,
      },
      bookingContext: {
        tenant,
        bookingId: booking.id,
        timeBegin: booking.timeBegin,
        timeEnd: booking.timeEnd,
        externalBookingId: lockerInfo.processId,
        lastOpenBoxId: lockerInfo.ifbsMetadata?.lastOpenBoxId,
        accessBuffer: { beforeMs, afterMs },
        accessFrom: booking.timeBegin - beforeMs,
        accessTo: booking.timeEnd + afterMs,
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
              accessId: accessInfo?.accessId || null,
              saltoUserId: accessInfo?.saltoUserId || null,
              isProvisioned: accessInfo?.isProvisioned || false,
              provisionedAt: accessInfo?.provisionedAt || null,
              revokedAt: accessInfo?.revokedAt || null,
              saltoUserDeletedAt: accessInfo?.saltoUserDeletedAt || null,
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
