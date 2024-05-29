const BookingManager = require("../../data-managers/booking-manager");
const TenantManager = require("../../data-managers/tenant-manager");
const axios = require("axios");
/**
 * BaseLocker is a class that represents a locker reservation system.
 * It is intended to be extended by other classes that implement the specific logic for different types of lockers.
 */
class BaseLocker {
  /**
   * Constructs a new BaseLocker instance.
   * @param {string} tenantId - The ID of the tenant reserving the locker.
   * @param {string} bookingId - The ID of the booking.
   * @param {string} unitId - The ID of the locker unit being reserved.
   */
  constructor(tenantId, bookingId, unitId) {
    this.tenantId = tenantId;
    this.bookingId = bookingId;
    this.unitId = unitId;
  }

  /**
   * Starts a new reservation.
   * This method should be overridden by subclasses.
   */
  startReservation() {}

  /**
   * Updates an existing reservation.
   * This method should be overridden by subclasses.
   */
  updateReservation(timeBegin, timeEnd) {}

  /**
   * Cancels an existing reservation.
   * This method should be overridden by subclasses.
   */
  cancelReservation(unitId) {}
}

class ParevaLocker extends BaseLocker {
  async startReservation(timeBegin, timeEnd) {
    try {
      const booking = await this.getBooking();
      const locker = this.getLocker(booking);
      const tenant = await this.getTenant();
      const parevaApp = this.getParevaApp(tenant);

      const { user: username, password, serverUrl, lockerId } = parevaApp;

      const { mail: userEmail } = booking;
      const productId = locker.unitId;

      const [timeBeginTimestamp, timeEndTimestamp] = [
        new Date(timeBegin).getTime(),
        new Date(timeEnd).getTime(),
      ];
      const duration = timeEndTimestamp - timeBeginTimestamp;
      const trimmedUrl = serverUrl.replace(/\/$/, "");

      const data = JSON.stringify({
        managerAssignment: false,
        email: userEmail,
        plannedBegin: `${timeBeginTimestamp}`,
        date_estimate_delivery: `${duration}`,
        fromEmail: userEmail,
        itemName: "",
        additionalInfo: {},
      });

      const base64Credentials = Buffer.from(`${username}:${password}`).toString(
        "base64",
      );

      const config = this.createAxiosConfig(
        "post",
        `${trimmedUrl}/locker/${lockerId}/rental/${productId}/open`,
        base64Credentials,
        data,
      );

      const response = await axios.request(config);

      locker.processId = response.data.processId;
      return locker;
    } catch (err) {
      throw new Error(`${err.message}`);
    }
  }

  async updateReservation(timeBegin, timeEnd) {
    try {
      await this.cancelReservation();
      return await this.startReservation(timeBegin, timeEnd);
    } catch (err) {
      throw new Error(`${err.message}`);
    }
  }

  async cancelReservation() {
    try {
      const booking = await this.getBooking();
      const locker = this.getLocker(booking);
      const tenant = await this.getTenant();
      const parevaApp = this.getParevaApp(tenant);

      const { user: username, password, serverUrl, lockerId } = parevaApp;
      const { processId } = locker;
      const trimmedUrl = serverUrl.replace(/\/$/, "");

      const base64Credentials = Buffer.from(`${username}:${password}`).toString(
        "base64",
      );

      const config = this.createAxiosConfig(
        "post",
        `${trimmedUrl}/locker/${lockerId}/process/${processId}/cancel`,
        base64Credentials,
      );

      const response = await axios.request(config);

      if (response.status !== 200) {
        throw new Error("Unable to cancel reservation");
      }

      return true;
    } catch (err) {
      console.error(err);
      throw new Error(`${err.message}`);
    }
  }

  async getBooking() {
    return await BookingManager.getBooking(this.bookingId, this.tenantId);
  }

  async getTenant() {
    return await TenantManager.getTenant(this.tenantId);
  }

  getLocker(booking) {
    const locker = booking.lockerInfo.find(
      (locker) => locker.id === this.unitId,
    );
    if (!locker) throw new Error("Locker not found");
    return locker;
  }

  getParevaApp(tenant) {
    const parevaApp = tenant.applications.find(
      (app) => app.type === "locker" && app.id === "pareva" && app.active,
    );
    if (!parevaApp) throw new Error("Pareva application not found");
    return parevaApp;
  }

  createAxiosConfig(method, url, base64Credentials, data = null) {
    const config = {
      method,
      maxBodyLength: Infinity,
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${base64Credentials}`,
      },
    };
    if (data) {
      config.data = data;
    }
    return config;
  }
}

module.exports = {
  BaseLocker,
  ParevaLocker,
};
