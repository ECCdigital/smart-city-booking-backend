module.exports = {
  name: "05-02-2025-rename-booking-tenant-id",

  up: async function (mongoose) {
    const Booking = mongoose.model("Booking");

    const allDocs = await Booking.find({});

    for (const doc of allDocs) {
      const obj = doc.toObject();
      let modified = false;

      if (obj.tenant) {
        obj.tenantId = obj.tenant;
        doc.tenant = undefined;
        modified = true;
      }

      if (Array.isArray(obj.bookableItems)) {
        obj.bookableItems.forEach((item) => {
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

      if (!obj.priceEur) {
        obj.priceEur = 0;
        modified = true;
      }

      if (!obj.vatIncludedEur) {
        obj.vatIncludedEur = 0;
        modified = true;
      }

      if (modified) {
        await Booking.replaceOne({ _id: doc._id }, obj);
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
