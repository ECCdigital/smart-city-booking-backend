const MailerService = require("../commons/mail-service/mail-service");
const {
  bookingLifecycle,
  TRIGGER,
} = require("../commons/services/booking-lifecycle");

module.exports = {
  test(doc, params) {
    return "test";
  },

  async cancelBooking(doc, params) {
    const bookingId = doc.id;
    const tenantId = doc.tenantId;
    const reason = params.reason || "";

    await bookingLifecycle.cancel(tenantId, bookingId, {
      trigger: TRIGGER.SYSTEM,
      reason,
    });
  },

  async sendEmail(doc, params = {}) {
    const tenantId = doc.tenantId;
    const address = params.to || doc.mail;

    if (!address) {
      throw new Error("sendEmail: no recipient address available");
    }

    if (!params.subject) {
      throw new Error("sendEmail: subject is required");
    }

    if (!params.body) {
      throw new Error("sendEmail: body is required");
    }
    await MailerService.send({
      tenantId,
      address,
      subject: params.subject,
      // The body acts as a Handlebars template; placeholders like {{name}}
      // are resolved against the matched document.
      mailTemplate: params.body,
      model: { ...doc, now: new Date() },
      useInstanceMail: params.useInstanceMail === true,
    });
  },
};
