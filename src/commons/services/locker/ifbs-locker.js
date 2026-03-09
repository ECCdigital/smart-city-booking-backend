const { BaseLocker } = require("./locker");
const TenantManager = require("../../data-managers/tenant-manager");
const { createClient } = require("./clients/locker-client-registry");
const crypto = require("crypto");
const bunyan = require("bunyan");
const { getUser } = require("../../data-managers/user-manager");

const APP_TYPE = "locker";

const logger = bunyan.createLogger({
  name: "ifbs-locker.js",
  level: process.env.LOG_LEVEL,
});

class IfbsLocker extends BaseLocker {
  async getClient(provider = "ifbs") {
    const tenant = await TenantManager.getTenant(this.tenantId);
    const rawApp = tenant.applications.find(
      (a) =>
        a.type === APP_TYPE && a.id === provider && a.active,
    );

    if (!rawApp) {
      throw new Error(
        `No active locker application '${provider}' ` +
        `found for tenant '${this.tenantId}'`,
      );
    }

    //this._secretPhrase = rawApp.secretPhrase;
    this._secretPhrase = "IamSecret";
    return createClient(rawApp);
  }

  async startReservation(timeBegin, timeEnd) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking);
    const client = await this.getClient();

    const user = await getUser(booking.assignedUserId);
    let userID = 1; // Default user ID for iFBS
    if(user && user._id) {
      userID = typeof user._id === 'string' ? user._id : user._id.toString();
    }


    const dateFrom = IfbsLocker.formatDate(timeBegin);
    const dateTo = IfbsLocker.formatDate(timeEnd);

    console.log("Starting reservation with params:", {
      lockerId: locker,
      dateFrom,
      dateTo,
      userID,
    });


    // 1) getBox – reserviert für 2 Min beim iFBS-Server
    const boxResult = await client.getBox(
      locker.id, // locationId
      dateFrom,
      dateTo,
      userID
    );


    if (!boxResult.Booking_ID) {
      throw new Error(
        `No available box at location ${locker.id}`,
      );
    }

    // 2) Checksum berechnen und bookIt aufrufen
    const checksum = IfbsLocker.calculateChecksum(
      boxResult.nummer,
      dateFrom,
      dateTo,
      this._secretPhrase,
    );

    console.log("Calculated checksum:", checksum);

    const bookingResult = await client.bookIt(
      boxResult.Booking_ID,
      checksum,
    );

    locker.processId = String(
      bookingResult.Booking_ID ?? boxResult.Booking_ID,
    );
    locker.isConfirmed = true;
    locker.ifbsMetadata = {
      boxId: boxResult.Box_ID,
      nummer: boxResult.nummer,
      price: boxResult.price,
      bookingId: boxResult.Booking_ID,
    };

    logger.info(
      `iFBS booking confirmed: processId=${locker.processId}`,
    );
    return locker;
  }

  async updateReservation(timeBegin, timeEnd) {
    await this.cancelReservation();
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
        `iFBS cancel failed for processId ${processId}: ` +
        err.message,
      );
      return { success: false, processId };
    }
  }

  getLocker(booking, processId) {
    console.log("lockerInfo", booking.lockerInfo)
    const locker = booking.lockerInfo.find(
      (l) =>
        l.id === this.id &&
        (processId === undefined ||
          l.processId === processId),
    );
    if (!locker) throw new Error("Locker not found");
    return locker;
  }

  /**
   * "YYYY-MM-DD HH:mm" – das Format, das iFBS erwartet
   */
  static formatDate(timestamp) {
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-` +
      `${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  /**
   * MD5 laut iFBS-Spec:
   * md5(nummer + urlEncode(DATEfrom) + urlEncode(DATEto) + secretPhrase)
   */
  static calculateChecksum(
    nummer,
    dateFrom,
    dateTo,
    secretPhrase,
  ) {

    console.log("Calculating checksum with values:", {
      nummer,
      dateFrom,
      dateTo,
      secretPhrase,
    });

    const encode = (value) =>
      new URLSearchParams({ v: value }).toString().slice(2);


    const raw =
      String(nummer) +
      encode(dateFrom) +
      encode(dateTo) +
      secretPhrase;

    return crypto.createHash("md5").update(raw).digest("hex");
  }
}

module.exports = { IfbsLocker };