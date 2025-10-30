// 2025-10-28-migrate-bookable-to-new-schema.js
module.exports = {
  name: "2025-10-28-migrate-bookable-to-new-schema",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");

    const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;

    const toMinutes = (hhmm) =>
      parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);
    const clamp024 = (n) => Math.min(24, Math.max(0, n));
    const isHHMM = (s) => typeof s === "string" && HHMM.test(s);
    const isYMD = (s) => typeof s === "string" && YYYYMMDD.test(s);
    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const validWeekdays = (arr) =>
      Array.isArray(arr)
        ? arr.filter(
          (n) => Number.isInteger(n) && n >= 0 && n <= 6,
        )
        : [];

    const detectBookingKind = (b) => {
      const hasTimeFeatures =
        !!b.isScheduleRelated ||
        !!b.isTimePeriodRelated ||
        !!b.isOpeningHoursRelated ||
        !!b.isSpecialOpeningHoursRelated ||
        !!b.isLongRange
      return hasTimeFeatures ? "time" : "quantity";
    };

    const deriveTimeRelation = (b, bookingKind) => {
      if (bookingKind === "quantity") return "schedule";
      if (b.isTimePeriodRelated) return "time-period";
      if (b.isLongRange) {
        const t = b?.longRangeOptions?.type;
        if (t === "week") return "long-range-week";
        if (t === "month") return "long-range-month";
      }
      return "schedule";
    };

    const normalizeOpeningHours = (b) => {
      // regular (aus b.openingHours)
      const regHours = [];
      if (Array.isArray(b.openingHours)) {
        for (const h of b.openingHours) {
          const days = validWeekdays(h?.weekdays);
          const openTime = isHHMM(h?.startTime) ? h.startTime : null;
          const closeTime = isHHMM(h?.endTime) ? h.endTime : null;
          if (days.length && openTime && closeTime) {
            regHours.push({
              daysOfWeek: days,
              openTime,
              closeTime,
            });
          }
        }
      }
      const regularEnabled =
        !!b.isOpeningHoursRelated || regHours.length > 0;

      // specific (aus b.specialOpeningHours)
      const specHours = [];
      if (Array.isArray(b.specialOpeningHours)) {
        for (const h of b.specialOpeningHours) {
          const date = isYMD(h?.date) ? h.date : null;
          const openTime = isHHMM(h?.startTime) ? h.startTime : null;
          const closeTime = isHHMM(h?.endTime) ? h.endTime : null;
          if (date && openTime && closeTime) {
            if (toMinutes(closeTime) <= toMinutes(openTime)) {
              continue; // Validator im neuen Schema verlangt strict >
            }
            specHours.push({ date, openTime, closeTime });
          }
        }
      }
      const specificEnabled =
        !!b.isSpecialOpeningHoursRelated || specHours.length > 0;

      return {
        regular: {
          enabled: !!(regularEnabled && regHours.length),
          hours: regHours,
        },
        specific: {
          enabled: !!(specificEnabled && specHours.length),
          hours: specHours,
        },
      };
    };

    const normalizeGroupBooking = (gb) => ({
      enabled: !!(gb && gb.enabled),
      permittedRoles: Array.isArray(gb?.permittedRoles)
        ? gb.permittedRoles.filter(
          (r) => typeof r === "string" && r.trim() !== "",
        )
        : [],
    });

    const normalizePriceCategories = (pcs) => {
      if (!Array.isArray(pcs) || pcs.length === 0) {
        return [
          {
            priceEur: 0,
            interval: { start: null, end: null },
            fixedPrice: false,
            holidays: [],
            weekdays: [],
          },
        ];
      }

      return pcs.map((pc) => {
        // priceEur
        const priceEur = Math.max(0, Number(pc?.priceEur ?? 0));

        // interval
        let start = toNum(pc?.interval?.start);
        let end = toNum(pc?.interval?.end);
        if (start != null) start = clamp024(start);
        if (end != null) end = clamp024(end);
        let interval;
        if (start != null && end != null && start < end) {
          interval = { start, end };
        } else {
          interval = { start: null, end: null };
        }

        // holidays -> [YYYY-MM-DD]
        const holidaysRaw = Array.isArray(pc?.holidays)
          ? pc.holidays
          : [];
        const holidays = holidaysRaw
          .map((h) => {
            if (typeof h === "string" && isYMD(h)) return h;
            if (h && typeof h === "object") {
              if (typeof h.date === "string" && isYMD(h.date))
                return h.date;
              if (typeof h.day === "string" && isYMD(h.day))
                return h.day;
            }
            return null;
          })
          .filter(Boolean);

        // weekdays 0..6
        const weekdays = validWeekdays(pc?.weekdays);

        return {
          priceEur,
          interval,
          fixedPrice: !!pc?.fixedPrice,
          holidays,
          weekdays,
        };
      });
    };

    const bookables = await Bookable.find().lean();
    const ops = [];

    for (const b of bookables) {
      const update = {};
      const unset = {};

      // bookingKind / timeRelation
      const bookingKind = detectBookingKind(b);
      const timeRelation = deriveTimeRelation(b, bookingKind);
      update.bookingKind = bookingKind;
      update.timeRelation = timeRelation;

      // min/maxBookingDuration (im alten Schema nicht vorhanden)
      if (b.minBookingDuration === undefined) {
        update.minBookingDuration = null;
      }
      if (b.maxBookingDuration === undefined) {
        update.maxBookingDuration = null;
      }

      // openingHours (neu strukturieren)
      update.openingHours = normalizeOpeningHours(b);

      // groupBooking normalisieren
      update.groupBooking = normalizeGroupBooking(b.groupBooking);

      // priceCategories normalisieren
      update.priceCategories = normalizePriceCategories(
        b.priceCategories,
      );

      // priceType / VAT / enableCoupons absichern
      const allowedPriceTypes = [
        "per-hour",
        "per-day",
        "per-item",
        "per-square-meter",
      ];
      update.priceType = allowedPriceTypes.includes(b.priceType)
        ? b.priceType
        : "per-item";
      update.priceValueAddedTax =
        typeof b.priceValueAddedTax === "number" &&
        b.priceValueAddedTax >= 0
          ? b.priceValueAddedTax
          : 0;
      update.enableCoupons =
        b.enableCoupons !== undefined ? !!b.enableCoupons : true;

      // alte Flags/Strukturen entfernen
      unset.isScheduleRelated = null;
      unset.isTimePeriodRelated = null;
      unset.isOpeningHoursRelated = null;
      unset.isSpecialOpeningHoursRelated = null;
      unset.isLongRange = null;
      unset.longRangeOptions = null;
      unset.specialOpeningHours = null;

      update.timeUpdated = Date.now();

      ops.push({
        updateOne: {
          filter: { _id: b._id },
          update: { $set: update, $unset: unset },
        },
      });
    }

    if (ops.length > 0) {
      await Bookable.bulkWrite(ops, { ordered: false, strict: false });
    }
  },

  down: async function (mongoose) {
  },
};