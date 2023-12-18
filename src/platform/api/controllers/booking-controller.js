const BookableManager = require("../../../commons/data-managers/bookable-manager");
const BookingManager = require("../../../commons/data-managers/booking-manager");
const RoleManager = require("../../../commons/data-managers/role-manager");
const EventManager = require("../../../commons/data-managers/event-manager");
const { Booking } = require("../../../commons/entities/booking");
const { RolePermission } = require("../../../commons/entities/role");
const { v4: uuidv4 } = require("uuid");
const MailController = require("../../../commons/mail-service/mail-controller");
const OpeningHoursManager = require("../../../commons/utilities/opening-hours-manager");
const CouponManager = require("../../../commons/data-managers/coupon-manager");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const UserManager = require("../../../commons/data-managers/user-manager");

class BookingPermissions {
  static _isOwner(booking, userId, tenant) {
    return booking.assignedUserId === userId && booking.tenant === tenant;
  }

  static async _allowCreate(booking, userId, tenant) {
    return (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "create"
      ))
    );
  }

  static async _allowRead(booking, userId, tenant) {
    if (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "readAny"
      ))
    )
      return true;

    if (
      tenant === booking.tenant &&
      BookingPermissions._isOwner(booking, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "readOwn"
      ))
    )
      return true;

    return false;
  }

  static async _allowUpdate(booking, userId, tenant) {
    if (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "updateAny"
      ))
    )
      return true;

    if (
      BookingPermissions._isOwner(booking, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "updateOwn"
      ))
    )
      return true;

    return false;
  }

  static async _allowDelete(booking, userId, tenant) {
    if (
      tenant === booking.tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "deleteAny"
      ))
    )
      return true;

    if (
      tenant === booking.tenant &&
      BookingPermissions._isOwner(booking, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_BOOKINGS,
        "deleteOwn"
      ))
    )
      return true;

    return false;
  }
}

/**
 * Web Controller for Bookings.
 */
class BookingController {
  static async _populate(bookings) {
    for (let booking of bookings) {
      booking._populated = {
        bookable: await BookableManager.getBookable(
          booking.bookableId,
          booking.tenant
        ),
      };
    }
  }

  static anonymizeBooking(booking) {
    return {
      id: booking.id,
      tenant: booking.tenant,
      bookableIds: booking.bookableIds,
      timeBegin: booking.timeBegin,
      timeEnd: booking.timeEnd,
    };
  }

  /**
   * Get all bookings. If public-flag ist set, then all bookings can be received. Otherwise only bookings, the user is
   * allowed to read.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBookings(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const bookings = await BookingManager.getBookings(tenant);

    if (request.query.public === "true") {
      const anonymizedBookings = bookings.map((b) => {
        return BookingController.anonymizeBooking(b);
      });

      response.status(200).send(anonymizedBookings);
    } else if (user) {
      if (request.query.populate === "true") {
        await BookingController._populate(bookings);
      }

      const allowedBookings = [];
      for (const booking of bookings) {
        if (user && await BookingPermissions._allowRead(booking, user.id, user.tenant)) {
          allowedBookings.push(booking);
        }
      }

      response.status(200).send(allowedBookings);
    } else {
      response.sendStatus(403);
    }
  }

  /**
   * Get all Bookings assigned to the current user.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getAssignedBookings(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;

    const hasPermission = user.tenant === tenant;

    if (hasPermission) {
      const bookings = await BookingManager.getAssignedBookings(
        tenant,
        user.id
      );

      if (request.query.populate === "true") {
        await BookingController._populate(bookings);
      }

      response.status(200).send(bookings);
    } else {
      response.sendStatus(403);
    }
  }

  /**
   * Get all Bookings including those that have a relation to parent or child bookables.
   * IMPORTANT: User needs readAny-Permission to access this endpoint without public-flag.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getRelatedBookings(request, response) {
    const user = request.user;
    const tenant = request.params.tenant;
    const bookableId = request.params.id;

    const includeRelatedBookings = request.query.related === "true";
    const includeParentBookings = request.query.parent === "true";

    let bookings = await BookingManager.getRelatedBookings(tenant, bookableId);

    if (includeRelatedBookings) {
      let relatedBookables = await BookableManager.getRelatedBookables(
        bookableId,
        tenant
      );

      for (let relatedBookable of relatedBookables) {
        let relatedBookings = await BookingManager.getRelatedBookings(
          tenant,
          relatedBookable.id
        );

        bookings = bookings.concat(relatedBookings);
      }
    }

    if (includeParentBookings) {
      let parentBookables = await BookableManager.getParentBookables(
        bookableId,
        tenant
      );

      for (let parentBookable of parentBookables) {
        let parentBookings = await BookingManager.getRelatedBookings(
          tenant,
          parentBookable.id
        );

        bookings = bookings.concat(parentBookings);
      }
    }

    if (request.query.public === "true") {
      const anonymizedBookings = bookings.map((b) => {
        return {
          id: b.id,
          tenant: b.tenant,
          bookableId: b.bookableId,
          timeBegin: b.timeBegin,
          timeEnd: b.timeEnd,
        };
      });

      response.status(200).send(anonymizedBookings);
    } else if (user) {
      const hasPermission =
        user.tenant === tenant &&
        (await UserManager.hasPermission(
          user.id,
          user.tenant,
          RolePermission.MANAGE_BOOKINGS,
          "readAny"
        ));

      if (hasPermission) {
        response.status(200).send(bookings);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(403);
    }
  }

  /**
   * Get a single booking.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async getBooking(request, response) {
    const tenantId = request.params.tenant;

    const id = request.params.id;
    if (id) {
      const booking = await BookingManager.getBooking(id, tenantId);

        await BookingController._populate([booking]);
        response.status(200).send(booking);

    } else {
      response.sendStatus(400);
    }
  }

  /**
   * Get the status of a booking.
   *
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
    static async getBookingStatus(request, response) {
        const tenantId = request.params.tenant;
        const id = request.params.id;

        if (id) {
            const bookingStatus = await BookingManager.getBookingStatus(tenantId, id);

            response.status(200).send(bookingStatus);
            } else {
            response.sendStatus(400);
        }
    }

  /**
   * @obsolete Use createBooking or updateBooking instead.
   * @param request
   * @param response
   * @returns {Promise<void>}
   */
  static async storeBooking(request, response) {
    const booking = Object.assign(new Booking(), request.body);

    let isUpdate = !!(await BookingManager.getBooking(
      booking.id,
      booking.tenant
    ));

    if (isUpdate) {
      await BookingController.updateBooking(request, response);
    } else {
      await BookingController.createBooking(request, response);
    }
  }

  static async createBooking(request, response) {
    const user = request.user;
    const booking = Object.assign(new Booking(), request.body);

    if (await BookingPermissions._allowCreate(booking, user.id, user.tenant)) {
      await BookingManager.storeBooking(booking);
      response.status(201).send(booking);
    } else {
      response.sendStatus(403);
    }
  }

  static async updateBooking(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const booking = Object.assign(new Booking(), request.body);

    if (await BookingPermissions._allowUpdate(booking, user.id, user.tenant)) {
      await BookingManager.storeBooking(booking);
      response.status(201).send(booking);
    } else {
      response.sendStatus(403);
    }
  }

  static async removeBooking(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;

    const id = request.params.id;
    if (id) {
      const booking = await BookingManager.getBooking(id, tenant);

      if (
        await BookingPermissions._allowDelete(booking, user.id, user.tenant)
      ) {
        await BookingManager.removeBooking(id, tenant);
        response.sendStatus(200);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }

  static async commitBooking(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const isNotCommitted = false;

    const id = request.params.id;
    if (id) {
      const booking = await BookingManager.getBooking(id, tenant);

      if (
        await BookingPermissions._allowUpdate(booking, user.id, user.tenant)
      ) {
        if (
          booking.isPayed === true ||
          !booking.priceEur ||
          booking.priceEur === 0
        ) {
          await MailController.sendFreeBookingConfirmation(
            booking.mail,
            booking.id,
            booking.tenant
          );
          response.sendStatus(200);
        } else {
          await MailController.sendPaymentRequest(
            booking.mail,
            booking.id,
            booking.tenant
          );
          response.sendStatus(200);
        }

        booking.isCommitted = true;
        await BookingManager.storeBooking(booking);
      } else {
        response.sendStatus(403);
      }
    } else {
      response.sendStatus(400);
    }
  }

  static async checkout(request, response) {
    const tenantId = request.params.tenant;
    const user = request.user;
    const simulate = request.query.simulate === "true";

    const tenant = await TenantManager.getTenant(tenantId);

    let bookingAttempt = request.body;

    if (bookingAttempt.tenant && bookingAttempt.bookableIds?.length > 0) {
      const bookables = await BookableManager.getBookables(tenantId);

      const relevantBookables = bookables.filter((b) =>
        bookingAttempt.bookableIds.includes(b.id)
      );

      for (let bookable of relevantBookables) {
        if (!bookable.isBookable || !bookable.isPublic) {
          //send response with not allowed bookable
          response.status(400).send({
            message: "Bookable is not bookable",
          });
          return;
        }
      }

      let bookingConflicts = false;
      let autoCommitBooking = true;
      let totalPrice = 0;
      for (let bookable of relevantBookables) {
        autoCommitBooking = autoCommitBooking && bookable.autoCommitBooking;
        totalPrice += bookable.getTotalPrice(
          bookingAttempt.timeBegin,
          bookingAttempt.timeEnd
        );

        if (
          bookable.isScheduleRelated === true ||
          bookable.isTimePeriodRelated === true
        ) {
          let concurrentBookings = await BookingManager.getConcurrentBookings(
            bookable.id,
            bookable.tenant,
            bookingAttempt.timeBegin,
            bookingAttempt.timeEnd
          );

          // Find concurrent Bookings regarding related Bookables
          const relatedBookables = await BookableManager.getRelatedBookables(
            bookable.id,
            bookable.tenant
          );
          for (let relatedBookable of relatedBookables) {
            concurrentBookings = concurrentBookings.concat(
              await BookingManager.getConcurrentBookings(
                relatedBookable.id,
                relatedBookable.tenant,
                bookingAttempt.timeBegin,
                bookingAttempt.timeEnd
              )
            );
          }
          const parentBookables = await BookableManager.getParentBookables(
            bookable.id,
            bookable.tenant,
            []
          );
          for (let parentBookable of parentBookables) {
            concurrentBookings = concurrentBookings.concat(
              await BookingManager.getConcurrentBookings(
                parentBookable.id,
                parentBookable.tenant,
                bookingAttempt.timeBegin,
                bookingAttempt.timeEnd
              )
            );
          }

          bookingConflicts =
            bookingConflicts || concurrentBookings.length >= bookable.amount;


        } else {
          let concurrentBookings = await BookingManager.getRelatedBookings(
            tenantId,
            bookable.id
          );

          bookingConflicts =
            bookingConflicts || concurrentBookings.length >= bookable.amount;
        }

        // If Bookable is a Ticket and the Event is related to an ID with limited number of attendees, check if there
        // are enough seats for related event left
        if (bookable.type === "ticket" && bookable.eventId) {
          const event = await EventManager.getEvent(
            bookable.eventId,
            bookable.tenant,

          );
          const eventBookings = await BookingManager.getEventBookings(
            bookable.tenant,
            bookable.eventId
          );

          bookingConflicts =
            bookingConflicts ||
            (!event.attendees.maxAttendees &&
              eventBookings.length >= event.attendees.maxAttendees);
        }
      }

      // Check Opening Hours for Parent and Related Bookables
      const myBooking = await BookableManager.getBookable(
        bookingAttempt.bookableIds[0],
        bookingAttempt.tenant
      );
      if (myBooking.isScheduleRelated) {
        const parentBookables = [];
        for (const bookableId of bookingAttempt.bookableIds) {
          parentBookables.push(
            ...(await BookableManager.getParentBookables(bookableId, tenantId))
          );
        }
        const bookablesIdsToCheckOpeningHours = parentBookables;
        bookablesIdsToCheckOpeningHours.push(myBooking);

        for (const bookable of bookablesIdsToCheckOpeningHours) {
          // Check Opening Hours
          if (
            await OpeningHoursManager.hasOpeningHoursConflict(
              bookable,
              bookingAttempt.timeBegin,
              bookingAttempt.timeEnd
            )
          ) {
            bookingConflicts = true;
            break;
          }
        }
      }

      if (bookingConflicts === false) {
        let booking = Object.assign(new Booking(), bookingAttempt);

        booking.id = uuidv4();
        booking.tenant = tenantId;
        booking.isCommitted = autoCommitBooking;
        booking.isPayed = totalPrice === 0;
        booking.assignedUserId = user?.id;
        booking.priceEur = totalPrice;

        //Set priceEur to 0 if user has free-bookings permission and user exists
        if (
          user &&
          (await UserManager.hasPermission(
            user.id,
            user.tenant,
            RolePermission.FREE_BOOKINGS
          ))
        ) {
          booking.priceEur = 0;
          booking.isPayed = true;
        }

        if (simulate === false) {
          if (booking.coupon) {
            booking.priceEur = await CouponManager.applyCoupon(
              booking.coupon.id,
              booking.tenant,
              booking.priceEur
            );
          }
          await BookingManager.storeBooking(booking);
          if (!booking.isCommitted) {
            await MailController.sendBookingRequestConfirmation(
              booking.mail,
              booking.id,
              booking.tenant
            );
          }
          if (booking.isCommitted && booking.isPayed) {
            await MailController.sendBookingConfirmation(
              booking.mail,
              booking.id,
              booking.tenant
            );
          }

          await MailController.sendIncomingBooking(
            tenant.mail,
            booking.id,
            booking.tenant
          );
          response.status(201).send(booking);
        } else {
          response.status(200).send(booking);
        }
      } else {
        response.sendStatus(409);
      }
    } else {
      response.sendStatus(400);
    }
  }

  static async getEventBookings(request, response) {
    const tenantId = request.params.tenant;
    const user = request.user;
    const eventId = request.params.id;

    const bookables = await BookableManager.getBookables(tenantId);
    const eventTickets = bookables.filter(
      (b) => b.type === "ticket" && b.eventId === eventId
    );

    const bookings = await BookingManager.getBookings(tenantId);
    const eventBookings = bookings.filter((b) =>
      b.bookableIds.some((id) => eventTickets.some((t) => t.id === id))
    );

    const allowedBookings = [];
    for (const booking of eventBookings) {
      if (user && await BookingPermissions._allowRead(booking, user.id, user.tenant)) {
        allowedBookings.push(booking);
      }
    }

    response.status(200).send(allowedBookings);
  }
}

module.exports = BookingController;
