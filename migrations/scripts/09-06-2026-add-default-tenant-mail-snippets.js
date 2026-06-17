const {
  DEFAULT_MAIL_SNIPPETS,
  mergeDefaultMailSnippets,
} = require("../../src/commons/mail-service/templates/default-mail-snippets");

module.exports = {
  name: "09-06-2026-add-default-tenant-mail-snippets",

  up: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");
    const tenants = await Tenant.find({}, { id: 1, mailSnippets: 1 }).lean();

    for (const tenant of tenants) {
      const existing = tenant.mailSnippets || {};
      const merged = mergeDefaultMailSnippets(existing);

      const hasChanges = Object.keys(DEFAULT_MAIL_SNIPPETS).some((name) => {
        const current = existing[name];
        return typeof current !== "string" || current.trim() === "";
      });

      if (hasChanges) {
        await Tenant.updateOne({ id: tenant.id }, { $set: { mailSnippets: merged } });
      }
    }
  },

  down: async function (mongoose) {
    const Tenant = mongoose.model("Tenant");
    const tenants = await Tenant.find({}, { id: 1, mailSnippets: 1 }).lean();

    for (const tenant of tenants) {
      const existing = tenant.mailSnippets || {};
      const unsetNames = Object.keys(DEFAULT_MAIL_SNIPPETS).filter((name) => {
        const current = existing[name];
        return current === DEFAULT_MAIL_SNIPPETS[name];
      });

      if (unsetNames.length === 0) {
        continue;
      }

      const nextSnippets = { ...existing };
      unsetNames.forEach((name) => {
        delete nextSnippets[name];
      });

      await Tenant.updateOne(
        { id: tenant.id },
        { $set: { mailSnippets: nextSnippets } },
      );
    }
  },
};
