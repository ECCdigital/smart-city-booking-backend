/**
 * The customer view of a booking (tenant supervision spec §5.2, §6.1): what
 * the booking-bound customer routes - `GET /api/bookings/assigned`, the
 * booking status v1 and v2, `GET /api/access/bookings` - add to each booking
 * so a customer's pages render from the booking answer alone and never from
 * the public tenant or catalog projection, which a non-public tenant does
 * not have.
 *
 * Per booking: `tenant`, the snapshot of `Tenant#exportBookingSnapshot`
 * (`null` for a deleted tenant), and for a ticket booking `event`, the core
 * data `{ id, title, timeBegin, timeEnd }` of the event (`null` when the
 * event is gone) - no description, no prices, no media: the booking vouches
 * for the tenant and the event, not for their offer. One tenant query and
 * one event query per answer, whatever the number of bookings; nothing is
 * written.
 */

const TenantManager = require("../../data-managers/tenant-manager");
const EventManager = require("../../data-managers/event-manager");
const { DOMAIN } = require("../authorization/reach");
const { BOOKABLE_TYPES } = require("../../entities/bookable/bookable");

const eventKey = (tenantId, id) => `${tenantId}\u0000${id}`;

/**
 * The event a ticket booking is for, read off the booking's own snapshot of
 * the ticket (`_bookableUsed`): the first ticket item names it. A booking
 * from before the snapshot names no event, and gets none - the view reads
 * the booking, it loads no bookable.
 *
 * @param {Object} booking
 * @returns {{tenantId: string, id: string}|null}
 */
function eventRefOf(booking) {
  const ticket = (booking.bookableItems || []).find(
    (item) =>
      item?._bookableUsed?.type === BOOKABLE_TYPES.TICKET &&
      item._bookableUsed.eventId,
  );
  return ticket
    ? { tenantId: booking.tenantId, id: ticket._bookableUsed.eventId }
    : null;
}

/**
 * The core data of an event as a booking carries it.
 *
 * @param {import("../../entities/event/event").Event} event
 * @returns {{ id: string, title: string, timeBegin: number|null, timeEnd: number|null }}
 */
function eventCoreData(event) {
  return {
    id: event.id,
    title: event.information?.name ?? "",
    timeBegin: event.getStartDateTime()?.getTime() ?? null,
    timeEnd: event.getEndDateTime()?.getTime() ?? null,
  };
}

/**
 * Loads the customer view of some bookings and answers the function that
 * names each booking's part of it.
 *
 * @param {Object[]} bookings The bookings of the answer (entities or
 *   documents with `tenantId` and `bookableItems`)
 * @returns {Promise<(booking: Object) => { tenant: Object|null, event?: Object|null }>}
 *   `event` is present for a ticket booking only
 */
async function customerViewOf(bookings) {
  const tenantIds = [...new Set(bookings.map((b) => b.tenantId))];
  const eventRefs = bookings.map(eventRefOf).filter(Boolean);

  const [tenants, events] = await Promise.all([
    TenantManager.getTenantsByIds(tenantIds),
    eventRefs.length ? EventManager.getEventsByIds(eventRefs, DOMAIN) : [],
  ]);

  const snapshotByTenant = new Map(
    tenants.map((t) => [t.id, t.exportBookingSnapshot()]),
  );
  const eventByKey = new Map(
    events.map((e) => [eventKey(e.tenantId, e.id), eventCoreData(e)]),
  );

  return (booking) => {
    const view = { tenant: snapshotByTenant.get(booking.tenantId) ?? null };
    const ref = eventRefOf(booking);
    if (ref) {
      view.event = eventByKey.get(eventKey(ref.tenantId, ref.id)) ?? null;
    }
    return view;
  };
}

/**
 * The bookings projected for a customer, each with its part of the view.
 *
 * @param {Object[]} bookings
 * @param {(booking: Object) => Object} project The booking as the route
 *   answers it, e.g. `(b) => b.exportStatus()`
 * @returns {Promise<Object[]>}
 */
async function withCustomerView(bookings, project) {
  const viewOf = await customerViewOf(bookings);
  return bookings.map((booking) => ({
    ...project(booking),
    ...viewOf(booking),
  }));
}

module.exports = { customerViewOf, withCustomerView };
