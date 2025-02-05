module.exports = {
  name: "05-02-2025-rename-booking-tenant-id",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    const allDocs = await Booking.find({});

    for (const doc of allDocs) {
      let modified = false;

      if (doc.tenant) {
        doc.tenantId = doc.tenant;
        doc.tenant = undefined;
        modified = true;
      }

      if (Array.isArray(doc.bookableItems)) {
        doc.bookableItems.forEach((item) => {
          if (item.tenant) {
            item.tenantId = item.tenant;
            delete item.tenant;
            modified = true;
          }

          if (item._bookableUsed && item._bookableUsed.tenant) {
            item._bookableUsed.tenantId = item._bookableUsed.tenant;
            delete item._bookableUsed.tenant;
            modified = true;
          }
        });
      }

      if (!doc.priceEur) {
        doc.priceEur = 0;
        modified = true;
      }

      if (!doc.vatIncludedEur) {
        doc.vatIncludedEur = 0;
        modified = true;
      }

      if (modified) {
        await doc.save();
      }
    }
  },

  down: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    const allDocs = await Booking.find({});

    for (const doc of allDocs) {
      let modified = false;

      if (doc.tenantId) {
        doc.tenant = doc.tenantId;
        doc.tenantId = undefined;
        modified = true;
      }

      if (Array.isArray(doc.bookableItems)) {
        doc.bookableItems.forEach((item) => {
          if (item.tenantId) {
            item.tenant = item.tenantId;
            delete item.tenantId;
            modified = true;
          }

          if (item._bookableUsed && item._bookableUsed.tenantId) {
            item._bookableUsed.tenant = item._bookableUsed.tenantId;
            delete item._bookableUsed.tenantId;
            modified = true;
          }
        });
      }

      if (modified) {
        await doc.save();
      }
    }
  },
};
