const { BookableManager } = require("../data-managers/bookable-manager");
const { ItemCheckoutService } = require("./checkout/item-checkout-service");

class CalendarService {
  static async checkAvailability(
    tenantId,
    bookableId,
    start,
    end,
    amount,
    user,
  ) {
    const startDate = start ? new Date(start) : new Date();
    const endDate = end
      ? new Date(end)
      : new Date(startDate.getTime() + 60000 * 60 * 24 * 7);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(24, 0, 0, 0);

    const [bookable, parentBookables, relatedBookables] = await Promise.all([
      BookableManager.getBookable(bookableId, tenantId),
      BookableManager.getParentBookables(bookableId, tenantId),
      BookableManager.getRelatedBookables(bookableId, tenantId),
    ]);

    if (bookable.amount < amount) {
      return [
        {
          timeBegin: start,
          timeEnd: end,
          available: false,
        },
      ];
    }

    const bookablesToCheck = [
      bookable,
      ...parentBookables,
      ...relatedBookables.filter((b) => b.id !== bookable.id),
    ];

    /**
     * Represents the available opening hours periods for a specific date range and bookable items.
     *
     * This variable is generated using the `generateTimePeriodsFromOpeningHours` function,
     * which takes a start date, an end date, and a list of bookable items to calculate available
     * time periods based on their opening hours.
     *
     * @type {Array<Object>}
     */
    const availableOpeningHoursPeriods = generateTimePeriodsFromOpeningHours(
      startDate,
      endDate,
      [bookable, ...parentBookables],
    );

    const availableTimePeriods = generateTimePeriodsFromTimePeriods(
      startDate,
      endDate,
      bookable,
    );

    /**
     * Represents the available special opening hours periods for a specific entity or location.
     * This variable holds an array of time periods generated based on defined special opening hours,
     * considering a given time range and related bookable items.
     *
     * The periods are dynamically created using the `generateTimePeriodsFromSpecialOpeningHours`
     * function, which takes into account the start date, end date, the current bookable item,
     * and any associated parent bookable items.
     *
     * @type {Array} An array of time periods representing the special opening hours.
     */
    const availableSpecialOpeningHoursPeriods =
      generateTimePeriodsFromSpecialOpeningHours(startDate, endDate, [
        bookable,
        ...parentBookables,
      ]);

    const availablePeriods = mergePeriods(
      availableOpeningHoursPeriods,
      availableSpecialOpeningHoursPeriods,
      availableTimePeriods,
    );

    const items = [];
    for (const period of availablePeriods) {
      if (period.available) {
        await checkAvailabilityIterative(
          period.start,
          period.end,
          items,
          bookablesToCheck,
          tenantId,
          bookableId,
          user,
          Number(amount),
        );
      } else {
        items.push({
          timeBegin: period.start,
          timeEnd: period.end,
          available: false,
        });
      }
    }
    return combineSegments(items);
  }
}

async function checkAvailabilityIterative(
  initialStart,
  initialEnd,
  items,
  bookablesToCheck,
  tenantId,
  bookableId,
  user,
  amount,
) {
  const SEGMENT_MIN_LENGTH = 15 * 60 * 1000;
  const queue = [{ start: initialStart, end: initialEnd }];

  while (queue.length > 0) {
    const { start, end } = queue.shift();

    let ics = null;

    try {
      ics = new ItemCheckoutService(
        user?.id,
        tenantId,
        start,
        end,
        bookableId,
        amount,
        null,
      );
      await ics.init();

      await ics.checkPermissions();
      await ics.checkOpeningHours();
      await ics.checkAvailability();
      await ics.checkEventSeats();
      await ics.checkParentAvailability();
      await ics.checkChildBookings();
      await ics.checkMaxBookingDate();

      items.push({ timeBegin: start, timeEnd: end, available: true });
    } catch (error) {
      const { concurrentBookings } = error;

      if (concurrentBookings?.length) {
        const availableSlots = bookablesToCheck[0]?.amount || 1;
        const maxAllowedOverlap = Math.max(0, availableSlots - amount);
        const { validIntervals, invalidIntervals } = splitByOverlapThreshold(
          { start, end },
          concurrentBookings.map((cb) => ({
            start: cb.timeBegin,
            end: cb.timeEnd,
          })),
          maxAllowedOverlap,
        );

        for (const inv of invalidIntervals) {
          items.push({
            timeBegin: inv.start,
            timeEnd: inv.end,
            available: false,
          });
        }
        for (const valid of validIntervals) {
          if (valid.end - valid.start > SEGMENT_MIN_LENGTH) {
            // queue.push({ start: valid.start, end: valid.end });
          } else {
            items.push({
              timeBegin: valid.start,
              timeEnd: valid.end,
              available: false,
            });
          }
        }
      } else {
        const segmentLength = end - start;
        if (segmentLength > SEGMENT_MIN_LENGTH) {
          const middle = Math.round((start + end) / 2);
          queue.push({ start, end: middle });
          queue.push({ start: middle, end });
        } else {
          items.push({ timeBegin: start, timeEnd: end, available: false });
        }
      }
    } finally {
      if (ics) {
        ics.cleanup();
        ics = null;
      }
    }
  }
}

function mergeTwoPeriodSets(base, overlay) {
  const P = [...base].sort((a, b) => a.start - b.start);
  const S = [...overlay].sort((a, b) => a.start - b.start);
  const result = [];

  let j = 0;
  for (const p of P) {
    let curStart = p.start;

    while (j < S.length && S[j].end <= p.start) j++;

    let k = j;
    while (k < S.length && S[k].start < p.end) {
      const s = S[k];
      if (s.start > curStart) {
        result.push({
          start: curStart,
          end: Math.min(s.start, p.end),
          available: p.available,
        });
      }
      const overlapStart = Math.max(s.start, p.start);
      const overlapEnd = Math.min(s.end, p.end);
      result.push({
        ...s,
        start: overlapStart,
        end: overlapEnd,
      });
      curStart = overlapEnd;
      if (curStart >= p.end) break;
      k++;
    }

    if (curStart < p.end) {
      result.push({
        start: curStart,
        end: p.end,
        available: p.available,
      });
    }
  }

  return result.sort((a, b) => a.start - b.start);
}

function mergePeriods(...periodSets) {
  const lists = periodSets.filter(
    (lst) => Array.isArray(lst) && lst.length > 0,
  );

  if (lists.length === 0) return [];
  if (lists.length === 1) {
    return [...lists[0]].sort((a, b) => a.start - b.start);
  }

  let acc = [...lists[0]];
  for (let i = 1; i < lists.length; i++) {
    acc = mergeTwoPeriodSets(acc, lists[i]);
  }

  const merged = [];
  for (const seg of acc) {
    const last = merged[merged.length - 1];
    if (last && last.available === seg.available && last.end === seg.start) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function splitByOverlapThreshold(interval, subs, maxOverlap) {
  const { start: A, end: B } = interval;

  const clipped = subs
    .map(({ start, end }) => ({
      start: Math.max(start, A),
      end: Math.min(end, B),
    }))
    .filter((iv) => iv.start < iv.end);

  const events = [];
  for (const { start, end } of clipped) {
    events.push({ x: start, delta: +1 });
    events.push({ x: end, delta: -1 });
  }
  events.push({ x: A, delta: 0 });
  events.push({ x: B, delta: 0 });

  events.sort((e1, e2) => e1.x - e2.x || e1.delta - e2.delta);

  let count = 0;
  let prevX = A;
  const validIntervals = [];
  const invalidIntervals = [];

  for (const ev of events) {
    const x = ev.x;
    if (x > prevX) {
      const segment = { start: prevX, end: x };
      if (count <= maxOverlap) {
        validIntervals.push(segment);
      } else {
        invalidIntervals.push(segment);
      }
    }
    count += ev.delta;
    prevX = x;
  }

  if (invalidIntervals.length === 0) {
    return {
      validIntervals: [{ start: A, end: B }],
      invalidIntervals: [],
    };
  }

  return { validIntervals, invalidIntervals };
}

function mergeOpeningHours(periods) {
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const toTime = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const flat = [];
  for (const { weekdays, startTime, endTime } of periods) {
    const s = toMinutes(startTime),
      e = toMinutes(endTime);
    for (const wd of weekdays) {
      flat.push({ weekday: wd, start: s, end: e });
    }
  }

  const byDay = flat.reduce((acc, iv) => {
    (acc[iv.weekday] = acc[iv.weekday] || []).push(iv);
    return acc;
  }, {});

  const mergedByDay = {};
  for (const [wd, ivs] of Object.entries(byDay)) {
    ivs.sort((a, b) => a.start - b.start);
    let result = [];

    if (ivs.length === 1) {
      result = [ivs[0]];
    } else {
      for (let i = 0; i < ivs.length - 1; i++) {
        const a = ivs[i],
          b = ivs[i + 1];
        const start = Math.max(a.start, b.start);
        const end = Math.min(a.end, b.end);
        if (start < end) {
          result.push({ weekday: Number(wd), start, end });
        }
      }
      if (result.length === 0) {
        result = ivs;
      }
    }

    mergedByDay[wd] = result;
  }

  const map = {};
  for (const segs of Object.values(mergedByDay)) {
    for (const { weekday, start, end } of segs) {
      const key = `${start}-${end}`;
      if (!map[key]) map[key] = { weekdays: [], start, end };
      map[key].weekdays.push(weekday);
    }
  }

  return Object.values(map)
    .map(({ weekdays, start, end }) => ({
      weekdays: weekdays.sort((a, b) => a - b),
      startTime: toTime(start),
      endTime: toTime(end),
    }))
    .sort((a, b) => {
      const da = toMinutes(a.startTime) - toMinutes(b.startTime);
      return da !== 0 ? da : a.weekdays[0] - b.weekdays[0];
    });
}

function generateTimePeriodsFromTimePeriods(startDate, endDate, bookable) {
  const allTimePeriods =
    bookable.isTimePeriodRelated && bookable.timePeriods.length > 0
      ? bookable.timePeriods
      : [];

  const mergedTimePeriods = mergeOpeningHours(allTimePeriods);

  return buildPeriodsFromMergedHours(
    startDate,
    endDate,
    mergedTimePeriods,
    true,
  );
}

function generateTimePeriodsFromOpeningHours(startDate, endDate, bookables) {
  const allOpeningHours = [];

  for (const bookable of bookables) {
    if (
      bookable.isOpeningHoursRelated &&
      bookable.openingHours &&
      bookable.openingHours.length > 0
    ) {
      allOpeningHours.push(...bookable.openingHours);
    }
  }

  const mergedOpeningHours = mergeOpeningHours(allOpeningHours);

  return buildPeriodsFromMergedHours(
    startDate,
    endDate,
    mergedOpeningHours,
    true,
  );
}

function buildPeriodsFromMergedHours(
  startDate,
  endDate,
  mergedHours,
  defaultAvailableWhenEmpty = false,
) {
  if (!mergedHours || mergedHours.length === 0) {
    if (defaultAvailableWhenEmpty) {
      return [
        {
          start: startDate.getTime(),
          end: endDate.getTime(),
          available: true,
        },
      ];
    }

    const periods = [];
    let current = new Date(startDate);
    while (current <= endDate) {
      const startOfDay = new Date(current);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(current);
      endOfDay.setHours(23, 59, 59, 999);

      periods.push({
        start: startOfDay.getTime(),
        end: endOfDay.getTime(),
        available: false,
      });

      current.setDate(current.getDate() + 1);
    }
    return periods;
  }

  const periods = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    const weekday = current.getDay();

    const hoursForToday = mergedHours.filter((hours) => {
      if (Array.isArray(hours.weekdays)) {
        return hours.weekdays.includes(weekday);
      }
      return hours.weekdays === weekday;
    });

    if (hoursForToday.length > 0) {
      for (const hour of hoursForToday) {
        const start = new Date(current);
        const [sh, sm] = hour.startTime.split(":").map(Number);
        start.setHours(sh, sm, 0, 0);

        const end = new Date(current);
        const [eh, em] = hour.endTime.split(":").map(Number);
        end.setHours(eh, em, 0, 0);

        periods.push({
          start: start.getTime(),
          end: end.getTime(),
          available: true,
        });
      }

      const sorted = [...hoursForToday].sort((a, b) => {
        const [aH, aM] = a.startTime.split(":").map(Number);
        const [bH, bM] = b.startTime.split(":").map(Number);
        return aH * 60 + aM - (bH * 60 + bM);
      });

      const startOfDay = new Date(current);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(current);
      endOfDay.setHours(23, 59, 59, 999);

      const firstStart = new Date(current);
      {
        const [h, m] = sorted[0].startTime.split(":").map(Number);
        firstStart.setHours(h, m, 0, 0);
      }
      if (firstStart.getTime() > startOfDay.getTime()) {
        periods.push({
          start: startOfDay.getTime(),
          end: firstStart.getTime(),
          available: false,
        });
      }

      for (let i = 0; i < sorted.length - 1; i++) {
        const currentEnd = new Date(current);
        {
          const [h, m] = sorted[i].endTime.split(":").map(Number);
          currentEnd.setHours(h, m, 0, 0);
        }

        const nextStart = new Date(current);
        {
          const [h, m] = sorted[i + 1].startTime.split(":").map(Number);
          nextStart.setHours(h, m, 0, 0);
        }

        if (nextStart.getTime() > currentEnd.getTime()) {
          periods.push({
            start: currentEnd.getTime(),
            end: nextStart.getTime(),
            available: false,
          });
        }
      }

      const lastEnd = new Date(current);
      {
        const last = sorted[sorted.length - 1];
        const [h, m] = last.endTime.split(":").map(Number);
        lastEnd.setHours(h, m, 0, 0);
      }
      if (lastEnd.getTime() < endOfDay.getTime()) {
        periods.push({
          start: lastEnd.getTime(),
          end: endOfDay.getTime(),
          available: false,
        });
      }
    } else {
      const startOfDay = new Date(current);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(current);
      endOfDay.setHours(23, 59, 59, 999);

      periods.push({
        start: startOfDay.getTime(),
        end: endOfDay.getTime(),
        available: false,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  return periods;
}

function generateTimePeriodsFromSpecialOpeningHours(
  startDate,
  endDate,
  bookables,
) {
  const allSpecialOpeningHours = [];

  for (const bookable of bookables) {
    if (
      bookable.isSpecialOpeningHoursRelated &&
      bookable.specialOpeningHours &&
      bookable.specialOpeningHours.length > 0
    ) {
      bookable.specialOpeningHours.forEach((soh) => {
        allSpecialOpeningHours.push({
          ...soh,
          bookableId: bookable.id,
          bookableTitle: bookable.title,
        });
      });
    }
  }

  if (allSpecialOpeningHours.length === 0) {
    return [];
  }

  const periods = [];

  const specialOpeningHoursByDate = {};

  const startDateISO = startDate.toISOString().split("T")[0];
  const endDateISO = endDate.toISOString().split("T")[0];

  for (const soh of allSpecialOpeningHours) {
    const sohDateISO = new Date(soh.date).toISOString().split("T")[0];

    if (sohDateISO >= startDateISO && sohDateISO <= endDateISO) {
      if (!specialOpeningHoursByDate[sohDateISO]) {
        specialOpeningHoursByDate[sohDateISO] = [];
      }
      specialOpeningHoursByDate[sohDateISO].push(soh);
    }
  }

  let currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  while (currentDate <= endDate) {
    const currentDateISO = currentDate.toISOString().split("T")[0];
    const specialHoursForDate = specialOpeningHoursByDate[currentDateISO] || [];

    const startOfDay = new Date(
      Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    const endOfDay = new Date(
      Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate(),
        24,
        0,
        0,
        0,
      ),
    );

    if (specialHoursForDate.length > 0) {
      const closedDay = specialHoursForDate.some((soh) => {
        const startTime = soh.startTime;
        const endTime = soh.endTime;
        return startTime === endTime;
      });

      if (closedDay) {
        periods.push({
          start: startOfDay.getTime(),
          end: endOfDay.getTime(),
          available: false,
        });
      } else {
        specialHoursForDate.sort((a, b) => {
          return a.startTime.localeCompare(b.startTime);
        });

        const firstSoh = specialHoursForDate[0];
        const firstSohStart = new Date(
          `${firstSoh.date}T${firstSoh.startTime}`,
        );

        if (firstSohStart.getTime() > startOfDay.getTime()) {
          periods.push({
            start: startOfDay.getTime(),
            end: firstSohStart.getTime(),
            available: false,
          });
        }

        for (let i = 0; i < specialHoursForDate.length; i++) {
          const currentSoh = specialHoursForDate[i];
          const sohStart = new Date(
            `${currentSoh.date}T${currentSoh.startTime}`,
          );
          const sohEnd = new Date(`${currentSoh.date}T${currentSoh.endTime}`);

          periods.push({
            start: sohStart.getTime(),
            end: sohEnd.getTime(),
            available: true,
          });

          if (i < specialHoursForDate.length - 1) {
            const nextSoh = specialHoursForDate[i + 1];
            const nextSohStart = new Date(
              `${nextSoh.date}T${nextSoh.startTime}`,
            );

            if (sohEnd.getTime() < nextSohStart.getTime()) {
              periods.push({
                start: sohEnd.getTime(),
                end: nextSohStart.getTime(),
                available: false,
              });
            }
          }
        }

        const lastSoh = specialHoursForDate[specialHoursForDate.length - 1];

        const lastSohEnd = new Date(`${lastSoh.date}T${lastSoh.endTime}`);

        if (lastSohEnd.getTime() < endOfDay.getTime()) {
          lastSohEnd.getTime() < endOfDay.getTime();
          periods.push({
            start: lastSohEnd.getTime(),
            end: endOfDay.getTime(),
            available: false,
          });
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return periods;
}

async function checkSegmentAvailability(
  start,
  end,
  items,
  bookablesToCheck,
  tenantId,
  bookableId,
  user,
  amount,
) {
  const SEGMENT_MIN_LENGTH = 1800000;
  let ics = null;

  try {
    ics = new ItemCheckoutService(
      user?.id,
      tenantId,
      start,
      end,
      bookableId,
      amount,
      null,
    );
    await ics.init();

    await ics.checkPermissions();
    await ics.checkOpeningHours();
    await ics.checkAvailability();
    await ics.checkEventSeats();
    await ics.checkParentAvailability();
    await ics.checkChildBookings();
    await ics.checkMaxBookingDate();

    items.push({
      timeBegin: start,
      timeEnd: end,
      available: true,
    });
  } catch (error) {
    const { concurrentBookings } = error;

    if (concurrentBookings?.length) {
      const { validIntervals, invalidIntervals } = splitByOverlapThreshold(
        { start, end },
        concurrentBookings.map((cb) => ({
          start: cb.timeBegin,
          end: cb.timeEnd,
        })),
        concurrentBookings.length,
      );

      for (const interval of invalidIntervals) {
        items.push({
          timeBegin: interval.start,
          timeEnd: interval.end,
          available: false,
        });
      }

      for (const validInterval of validIntervals) {
        const middle = new Date(
          Math.round((validInterval.start + validInterval.end) / 2),
        );

        await checkSegmentAvailability(
          validInterval.start,
          middle.getTime(),
          items,
          bookablesToCheck,
          tenantId,
          bookableId,
          user,
          amount,
        );
        await checkSegmentAvailability(
          middle.getTime(),
          validInterval.end,
          items,
          bookablesToCheck,
          tenantId,
          bookableId,
          user,
          amount,
        );
      }
    } else {
      const segmentLength = end - start;

      if (segmentLength > SEGMENT_MIN_LENGTH) {
        const middle = new Date(Math.round((start + end) / 2));

        await checkSegmentAvailability(
          start,
          middle.getTime(),
          items,
          bookablesToCheck,
          tenantId,
          bookableId,
          user,
          amount,
        );
        await checkSegmentAvailability(
          middle.getTime(),
          end,
          items,
          bookablesToCheck,
          tenantId,
          bookableId,
          user,
          amount,
        );
      } else {
        items.push({
          timeBegin: start,
          timeEnd: end,
          available: false,
        });
      }
    }
  } finally {
    if (ics) {
      ics.cleanup();
      ics = null;
    }
  }
}

function combineSegments(segments) {
  if (segments.length === 0) {
    return [];
  }

  segments.sort((a, b) => a.timeBegin - b.timeBegin);

  const combined = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    if (
      segments[i].available === current.available &&
      segments[i].timeBegin === current.timeEnd
    ) {
      current.timeEnd = segments[i].timeEnd;
    } else {
      combined.push(current);
      current = { ...segments[i] };
    }
  }

  combined.push(current);

  return combined;
}

module.exports = CalendarService;
