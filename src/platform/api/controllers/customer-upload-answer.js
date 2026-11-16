const {
  CustomerUploadService,
} = require("../../../commons/services/customer-upload/customer-upload-service");
const {
  REACH,
  withinReach,
} = require("../../../commons/services/authorization");

/**
 * The bookings of an answer, each with the derived state of its customer
 * uploads (`customerUploadState`) - for the booking
 * person and for the readers of the tenant's bookings alike.
 *
 * With a scope, only the bookings within it carry the state: the reach of
 * `booking.readCustomerUploads` - the booking
 * person's own bookings, every booking for whoever reads the tenant's
 * bookings, none for the instance owner by the special position. The
 * others carry `null`. The references themselves (`customerUploads`) never
 * leave: what an answer shows of them is in the state.
 *
 * @param {Object[]} bookings Entities or their views, each with `id`
 * @param {Object[]} [sources] The bookings the state is read off, in the
 *   same order; the bookings themselves by default
 * @param {{reach: string|null, userId: string|null}} [scope] Who may read
 *   the state; everyone of the answer without one
 * @param {Object} [options]
 * @param {boolean} [options.withGroup] Whether each state names the group
 *   of its booking - for "my bookings"
 * @returns {Promise<Object[]>}
 */
async function withCustomerUploadState(
  bookings,
  sources = bookings,
  scope = null,
  { withGroup = false } = {},
) {
  const readable = sources.filter(
    (source) => !scope || withinReach(source, "assignedUserId", scope),
  );
  // The staff reads who checked; the customer does not.
  const states = await CustomerUploadService.statesOf(readable, {
    withReviewer: scope?.reach === REACH.ANY,
    withGroup,
  });
  bookings.forEach((booking, index) => {
    booking.customerUploadState = states.get(sources[index].id) ?? null;
    delete booking.customerUploads;
    delete booking.customerUploadRequests;
  });
  return bookings;
}

/**
 * Who may read the customer uploads of the bookings of a request: the
 * second decision of the route's marker - `readCustomerUploads` on a
 * booking route, `booking.readCustomerUploads` on a group's.
 *
 * @param {import("express").Request} request
 * @returns {{reach: string|null, userId: string|null}}
 */
const customerUploadScopeOf = (request) => ({
  reach:
    request.reaches?.readCustomerUploads ??
    request.reaches?.["booking.readCustomerUploads"] ??
    null,
  userId: request.principal?.userId ?? null,
});

/**
 * The member bookings of a group answer with the state of their customer
 * uploads, as far as the request may read it; a group answered without
 * its bookings populated is left as it is.
 *
 * @param {Object|null} groupBooking
 * @param {import("express").Request} request
 * @returns {Promise<Object|null>}
 */
async function withMemberCustomerUploadState(groupBooking, request) {
  const members = (groupBooking?.bookings || []).filter(
    (booking) => booking && typeof booking === "object",
  );
  if (members.length) {
    await withCustomerUploadState(
      members,
      members,
      customerUploadScopeOf(request),
    );
  }
  return groupBooking;
}

module.exports = {
  withCustomerUploadState,
  customerUploadScopeOf,
  withMemberCustomerUploadState,
};
