const { BaseLocker } = require("./locker");
const TenantManager = require("../../data-managers/tenant-manager");
const UserManager = require("../../data-managers/user-manager");
const { createClient } = require("./clients/locker-client-registry");
const IfbsApiClient = require("../access/clients/ifbs-api-client");
const bunyan = require("bunyan");

const APP_TYPE = "locker";

const logger = bunyan.createLogger({
  name: "ifbs-locker.js",
  level: process.env.LOG_LEVEL,
});

class IfbsLocker extends BaseLocker {
  async getClient(provider = "ifbs") {
    const tenant = await TenantManager.getTenant(this.tenantId);
    const rawApp = tenant.applications.find(
      (a) => a.type === APP_TYPE && a.id === provider && a.active,
    );

    if (!rawApp) {
      throw new Error(
        `No active locker application '${provider}' ` +
          `found for tenant '${this.tenantId}'`,
      );
    }

    this._secretPhrase = rawApp.secretPhrase;
    return createClient(rawApp);
  }

  async startReservation(timeBegin, timeEnd) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking);
    const client = await this.getClient();

    let boxResult;

    if (locker.ifbsMetadata?.bookingId && !locker.isConfirmed) {
      const preReservedAt = locker.ifbsMetadata.preReservedAt || 0;
      const isStillValid = Date.now() - preReservedAt < 2 * 60 * 1000;

      if (isStillValid) {
        boxResult = {
          Booking_ID: locker.ifbsMetadata.bookingId,
          Box_ID: locker.ifbsMetadata.boxId,
          nummer: locker.ifbsMetadata.nummer,
          price: locker.ifbsMetadata.price,
        };
        logger.info(
          `iFBS using existing pre-reservation: Booking_ID=${boxResult.Booking_ID}`,
        );
      } else {
        logger.info(
          `iFBS pre-reservation expired, fetching new box for location ${locker.id}`,
        );
        boxResult = await this._fetchNewBox(
          client,
          locker,
          booking,
          timeBegin,
          timeEnd,
        );
      }
    } else {
      boxResult = await this._fetchNewBox(
        client,
        locker,
        booking,
        timeBegin,
        timeEnd,
      );
    }

    if (!boxResult.Booking_ID) {
      throw new Error(`No available box at location ${locker.id}`);
    }

    const dateFrom = IfbsLocker.formatDate(timeBegin);
    const dateTo = IfbsLocker.formatDate(timeEnd);

    const checksum = IfbsLocker.calculateChecksum(
      boxResult.nummer,
      dateFrom,
      dateTo,
      this._secretPhrase,
    );

    const bookingResult = await client.bookIt(boxResult.Booking_ID, checksum);

    locker.processId = String(bookingResult.Booking_ID ?? boxResult.Booking_ID);
    locker.isConfirmed = true;
    locker.ifbsMetadata = {
      boxId: boxResult.Box_ID,
      nummer: boxResult.nummer,
      price: boxResult.price,
      bookingId: boxResult.Booking_ID,
    };

    logger.info(`iFBS booking confirmed: processId=${locker.processId}`);
    return locker;
  }

  /** @private */
  async _fetchNewBox(client, locker, booking, timeBegin, timeEnd) {
    const userID = IfbsApiClient.userId(
      await UserManager.getRawUser(booking.assignedUserId),
    );

    const dateFrom = IfbsLocker.formatDate(timeBegin);
    const dateTo = IfbsLocker.formatDate(timeEnd);

    const boxResult = await client.getBox(locker.id, dateFrom, dateTo, userID);
    this._secretPhrase =
      this._secretPhrase || (await this.getClient())._secretPhrase;
    return boxResult;
  }

  async updateReservation(_processId, timeBegin, timeEnd) {
    await this.cancelReservation(_processId);
    return await this.startReservation(timeBegin, timeEnd);
  }

  async cancelReservation(_processId) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking, _processId);
    const { processId } = locker;

    if (!processId) {
      return { success: false, processId: null };
    }

    try {
      const client = await this.getClient();
      const now = Date.now();
      const bookingStart = new Date(booking.timeBegin).getTime();

      if (now < bookingStart) {
        await client.cancelUsage(processId);
      } else {
        const newDateTo = IfbsLocker.formatDate(now);
        await client.endUsage(processId, newDateTo);
      }

      return { success: true, processId };
    } catch (err) {
      logger.error(
        `iFBS cancel failed for processId ${processId}: ` + err.message,
      );
      return { success: false, processId };
    }
  }

  async preReserve(timeBegin, timeEnd) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking);
    const client = await this.getClient();

    const userID = IfbsApiClient.userId(
      await UserManager.getRawUser(booking.assignedUserId),
    );

    const dateFrom = IfbsLocker.formatDate(timeBegin);
    const dateTo = IfbsLocker.formatDate(timeEnd);

    const boxResult = await client.getBox(locker.id, dateFrom, dateTo, userID);

    if (!boxResult.Booking_ID) {
      throw new Error(`No available box at location ${locker.id}`);
    }

    locker.processId = null;
    locker.isConfirmed = false;
    locker.ifbsMetadata = {
      boxId: boxResult.Box_ID,
      nummer: boxResult.nummer,
      price: boxResult.price,
      bookingId: boxResult.Booking_ID,
      preReservedAt: Date.now(),
    };

    logger.info(
      `iFBS pre-reservation held: Booking_ID=${boxResult.Booking_ID}, ` +
        `location=${locker.id}`,
    );

    return locker;
  }

  getLocker(booking, processId) {
    const locker = booking.lockerInfo.find(
      (l) =>
        l.id === this.id &&
        (processId === undefined || l.processId === processId),
    );
    if (!locker) throw new Error("Locker not found");
    return locker;
  }

  /**
   * "YYYY-MM-DD HH:mm", the format iFBS expects.
   */
  static formatDate(timestamp) {
    return IfbsApiClient.formatDate(timestamp);
  }

  /**
   * The checksum `bookIt` takes, as the client computes it.
   */
  static calculateChecksum(nummer, dateFrom, dateTo, secretPhrase) {
    return IfbsApiClient.checksum(nummer, dateFrom, dateTo, secretPhrase);
  }
}

module.exports = { IfbsLocker };
