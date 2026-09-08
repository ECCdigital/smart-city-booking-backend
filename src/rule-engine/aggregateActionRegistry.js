const MailerService = require("../commons/mail-service/mail-service");
const TenantManager = require("../commons/data-managers/tenant-manager");

/**
 * Aggregate actions receive ALL matched documents of a tenant group at once
 * (instead of being called per document). Signature:
 *
 *   handler(docs, params, context)
 *
 * where context = { tenantId, tenantMail }.
 *
 * The engine groups matched documents by tenant and calls the handler once
 * per tenant, so a single rule can notify each tenant about their own items.
 */
module.exports = {
  async sendAggregatedEmail(docs, params = {}, context = {}) {
    if (!docs || docs.length === 0) {
      return;
    }

    const tenantId = context.tenantId || docs[0].tenantId;
    const address = params.to || context.tenantMail;

    const tenant = await TenantManager.getTenant(tenantId);

    if (!tenant) {
      throw new Error("sendAggregatedEmail: tenant not found");
    }

    const tenantName = tenant.name;

    if (!address) {
      throw new Error(
        "sendAggregatedEmail: no recipient address available (set params.to or use $$TENANT_MAIL)",
      );
    }

    if (!params.subject) {
      throw new Error("sendAggregatedEmail: subject is required");
    }

    if (!params.body) {
      throw new Error("sendAggregatedEmail: body is required");
    }

    // The body is a Handlebars template. The matched documents are available
    // as `bookings` (and `items`), so the template can iterate them:
    //   {{#each bookings}} ... {{/each}}
    const html = await MailerService.renderHtml({
      mailTemplate: params.body,
      model: {
        bookings: docs,
        items: docs,
        count: docs.length,
        now: new Date(),
        tenant: tenantName,
      },
      tenantId,
    });
    await MailerService.send({
      type: "rule-aggregated-email",
      // A rule that says useInstanceMail sends as the instance.
      tenantId: params.useInstanceMail === true ? null : tenantId,
      to: address,
      subject: params.subject,
      html,
    });
  },
};
