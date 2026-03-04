const { BaseLocker } = require("./locker");
const axios = require("axios");

class IfbsLocker extends BaseLocker {
  async startReservation(timeBegin, timeEnd) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking);
    const tenant = await this.getTenant();
    const ifbsApp = this.getIfbsApp(tenant);

    const { apiKeyID, apiKey, serverUrl } = ifbsApp;
    const trimmedUrl = serverUrl.replace(/\/$/, "");

    // TODO: IFBS-spezifische API-Aufrufe implementieren
    const response = await axios.request({
      method: "post",
      url: `${trimmedUrl}/reserve`,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key-ID": apiKeyID,
        "X-API-Key": apiKey,
      },
      data: {
        unitId: locker.id,
        timeBegin,
        timeEnd,
        email: booking.mail,
      },
    });

    locker.processId = response.data.processId;
    locker.isConfirmed = true;
    return locker;
  }

  async updateReservation(timeBegin, timeEnd) {
    await this.cancelReservation();
    return await this.startReservation(timeBegin, timeEnd);
  }

  async cancelReservation(_processId) {
    const booking = await this.getBooking();
    const locker = this.getLocker(booking, _processId);
    const tenant = await this.getTenant();
    const { processId } = locker;

    if (!processId) {
      return { success: false, processId: null };
    }

    try {
      const ifbsApp = this.getIfbsApp(tenant);
      const { apiKeyID, apiKey, serverUrl } = ifbsApp;
      const trimmedUrl = serverUrl.replace(/\/$/, "");

      // TODO: IFBS-spezifische Cancel-API
      const response = await axios.request({
        method: "post",
        url: `${trimmedUrl}/cancel`,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key-ID": apiKeyID,
          "X-API-Key": apiKey,
        },
        data: { processId },
      });

      if (response.status === 200) {
        return { success: true, processId };
      }
      return { success: false, processId };
    } catch (err) {
      return { success: false, processId };
    }
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

  getIfbsApp(tenant) {
    const app = tenant.applications.find(
      (a) => a.type === "locker" && a.id === "ifbs" && a.active,
    );
    if (!app) throw new Error("IFBS application not found");
    return app;
  }
}

module.exports = { IfbsLocker };