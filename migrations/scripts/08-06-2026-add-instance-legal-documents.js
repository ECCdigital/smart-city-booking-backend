module.exports = {
  name: "08-06-2026-add-instance-legal-documents",

  up: async function (mongoose) {
    const Instance = mongoose.model("Instance");

    const instance = await Instance.findOne(
      {},
      {
        dataProtectionUrl: 1,
        legalNoticeUrl: 1,
        dataProtection: 1,
        legalNotice: 1,
        termsAndConditions: 1,
      },
    ).lean();

    if (!instance) return;

    const set = {};

    if (instance.dataProtection === undefined) {
      set.dataProtection = {
        source: "url",
        url: instance.dataProtectionUrl ?? "",
        fileName: "",
      };
    }

    if (instance.legalNotice === undefined) {
      set.legalNotice = {
        source: "url",
        url: instance.legalNoticeUrl ?? "",
        fileName: "",
      };
    }

    if (instance.termsAndConditions === undefined) {
      set.termsAndConditions = {
        source: "url",
        url: "",
        fileName: "",
      };
    }

    const update = {};
    if (Object.keys(set).length > 0) {
      update.$set = set;
    }

    update.$unset = { dataProtectionUrl: "", legalNoticeUrl: "" };

    await Instance.updateOne({}, update);
  },

  down: async function (mongoose) {
    const Instance = mongoose.model("Instance");

    const instance = await Instance.findOne(
      {},
      { dataProtection: 1, legalNotice: 1 },
    ).lean();

    await Instance.updateOne(
      {},
      {
        $set: {
          dataProtectionUrl: instance?.dataProtection?.url ?? "",
          legalNoticeUrl: instance?.legalNotice?.url ?? "",
        },
        $unset: {
          dataProtection: "",
          legalNotice: "",
          termsAndConditions: "",
        },
      },
    );
  },
};
