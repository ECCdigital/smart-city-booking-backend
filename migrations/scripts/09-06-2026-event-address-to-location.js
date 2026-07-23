module.exports = {
  name: "09-06-2026-event-address-to-location",

  up: async function (mongoose) {
    const Model = mongoose.model("Event");

    const documents = await Model.find({
      eventAddress: { $exists: true },
    }).lean();

    let migrated = 0;
    let skipped = 0;

    for (const doc of documents) {
      const addr = doc.eventAddress || {};

      if (doc.location?.coordinates?.type === "Point") {
        await Model.updateOne(
          { _id: doc._id },
          { $unset: { eventAddress: 1 } },
          { runValidators: false, strict: false },
        );
        skipped++;
        continue;
      }

      const street = [addr.street, addr.houseNumber].filter(Boolean).join(" ");
      const cityLine = [addr.zip, addr.city].filter(Boolean).join(" ");
      const displayAddress = [street, addr.additional, cityLine]
        .filter(Boolean)
        .join(", ");

      const newLocation = {
        coordinates: {
          type: "Point",
          points: [null, null],
        },
        display_address: displayAddress,
        address: {
          street: addr.street || null,
          house_number: addr.houseNumber || null,
          post_code: addr.zip || null,
          city: addr.city || null,
          suburb: null,
          state: null,
          country: null,
          country_code: null,
        },
        meta: {
          source: "legacy",
          place_id: null,
          additional: addr.additional || null,
          fetched_at: new Date().toISOString(),
        },
      };

      await Model.updateOne(
        { _id: doc._id },
        {
          $set: { location: newLocation },
          $unset: { eventAddress: 1 },
        },
        { runValidators: false, strict: false },
      );

      migrated++;
    }

    console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
  },

  down: async function (mongoose) {
    const Model = mongoose.model("Event");

    const documents = await Model.find({
      "location.display_address": { $exists: true },
    }).lean();

    let reverted = 0;

    for (const doc of documents) {
      const loc = doc.location || {};
      const address = loc.address || {};

      const eventAddress = {
        street: address.street || "",
        houseNumber: address.house_number || "",
        additional: loc.meta?.additional || "",
        city: address.city || "",
        zip: address.post_code || "",
      };

      await Model.updateOne(
        { _id: doc._id },
        {
          $set: { eventAddress },
          $unset: { location: 1 },
        },
        { runValidators: false, strict: false },
      );

      reverted++;
    }

    console.log(`Rollback complete: ${reverted} reverted`);
  },
};
