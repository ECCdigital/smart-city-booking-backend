module.exports = {
  name: "09-01-2026-location-format-migration",

  up: async function (mongoose) {
    const Model = mongoose.model("Bookable");

    const documents = await Model.find({
      location: { $exists: true },
    }).lean();

    let migrated = 0;
    let skipped = 0;

    for (const doc of documents) {
      const oldLocation = doc.location;

      // Bereits im neuen Format? Überspringen
      if (oldLocation?.coordinates?.type === "Point") {
        skipped++;
        continue;
      }

      let newLocation;

      if (typeof oldLocation === "string") {
        // Fall 1: location ist ein einfacher String
        newLocation = {
          coordinates: {
            type: "Point",
            points: [null, null],
          },
          display_address: oldLocation,
          address: {
            street: null,
            house_number: null,
            post_code: null,
            city: null,
            suburb: null,
            state: null,
            country: null,
            country_code: null,
          },
          meta: {
            source: "legacy",
            place_id: null,
            fetched_at: new Date().toISOString(),
          },
        };
      } else if ( oldLocation === null || oldLocation === undefined) {
        // Fall 3: location ist null oder undefined
        newLocation = {
          coordinates: {
            type: "Point",
            points: [null, null],
          },
          display_address: "",
          address: {
            street: null,
            house_number: null,
            post_code: null,
            city: null,
            suburb: null,
            state: null,
            country: null,
            country_code: null,
          },
          meta: {
            source: "legacy",
            place_id: null,
            fetched_at: new Date().toISOString(),
          },
        };
      } else if (typeof oldLocation === "object") {
        console.log(oldLocation);
        // Fall 2: location ist ein Objekt mit display_name/lat/lng
        const lat = oldLocation.lat ? parseFloat(oldLocation.lat) : null;
        const lon = oldLocation.lon || oldLocation.lng;
        const lonParsed = lon ? parseFloat(lon) : null;

        newLocation = {
          coordinates: {
            type: "Point",
            points: [lonParsed, lat],
          },
          display_address:
            oldLocation.display_name || oldLocation.display_address || "",
          address: oldLocation.address
            ? {
              street: oldLocation.address.road || null,
              house_number: oldLocation.address.house_number || null,
              post_code: oldLocation.address.postcode || null,
              city:
                oldLocation.address.city ||
                oldLocation.address.town ||
                oldLocation.address.village ||
                null,
              suburb:
                oldLocation.address.suburb ||
                oldLocation.address.neighbourhood ||
                null,
              state: oldLocation.address.state || null,
              country: oldLocation.address.country || null,
              country_code: oldLocation.address.country_code || null,
            }
            : {
              street: null,
              house_number: null,
              post_code: null,
              city: null,
              suburb: null,
              state: null,
              country: null,
              country_code: null,
            },
          meta: {
            source: "legacy",
            place_id: oldLocation.place_id || null,
            fetched_at: new Date().toISOString(),
          },
        };
      } else {
        skipped++;
        continue;
      }

      // Direkt überschreiben - kein Konflikt da wir location komplett ersetzen
      await Model.updateOne(
        { _id: doc._id },
        { $set: { location: newLocation } }
      );

      migrated++;
    }

    console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
  },

  down: async function (mongoose) {
    const Model = mongoose.model("Bookable");

    const documents = await Model.find({
      "location.display_address": { $exists: true },
    }).lean();

    let reverted = 0;

    for (const doc of documents) {
      const currentLocation = doc.location;

      // Zurück zum alten Format
      const oldFormat = {
        display_name: currentLocation.display_address || "",
        lat: currentLocation.location?.coordinates?.[1] || null,
        lng: currentLocation.location?.coordinates?.[0] || null,
      };

      await Model.updateOne(
        { _id: doc._id },
        { $set: { location: oldFormat } }
      );

      reverted++;
    }

    console.log(`Rollback complete: ${reverted} reverted`);
  },
};