/**
 * No taking over a foreign booking by its mail: correcting the first mail
 * of a booking of the Buchungsweg Admin moves the booking to the corrected
 * address (`ownerAfterEdit`), but never to the user who edits it, unless
 * they may delete every booking anyway. Otherwise `updateAny` and
 * `deleteOwn` together would delete any booking of the Buchungsweg Admin:
 * enter one's own mail, then delete one's "own" booking.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const {
  installHarness,
  adminForm,
  TENANT,
  ADMIN,
  CUSTOMER,
} = require("./helpers/booking-lifecycle-harness");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const { RoleManager } = require("../src/commons/data-managers/role-manager");
const { Role } = require("../src/commons/entities/role/role");

/** A member who edits every booking and deletes their own, no more. */
const EDITOR = "bearbeiter@example.test";
const ROLE_EDIT_DELETE_OWN = "role-edit-delete-own";

function roleEditDeleteOwn() {
  return new Role({
    id: ROLE_EDIT_DELETE_OWN,
    name: "Bearbeiten, eigene löschen",
    tenantId: TENANT,
    adminInterfaces: [],
    manageBookings: {
      create: false,
      readAny: true,
      readOwn: true,
      updateAny: true,
      updateOwn: true,
      deleteAny: false,
      deleteOwn: true,
    },
  });
}

function editorMembership() {
  return {
    userId: EDITOR,
    tenantId: TENANT,
    status: "active",
    source: "manually",
    owner: false,
    roles: [ROLE_EDIT_DELETE_OWN],
    bookingNotificationRecipients: [],
    invitations: [],
  };
}

describe("an edit never hands a booking to its editor without deleteAny", function () {
  let h;

  beforeEach(async function () {
    h = await installHarness();
    MembershipManager.getMembershipByTenantAndUserID
      .withArgs(TENANT, EDITOR)
      .callsFake(async () => editorMembership());
    MembershipManager.getMembershipsByUserID
      .withArgs(EDITOR)
      .callsFake(async () => [editorMembership()]);
    RoleManager.getRole
      .withArgs(ROLE_EDIT_DELETE_OWN)
      .callsFake(async () => roleEditDeleteOwn());
    RoleManager.getRolesByIds
      .withArgs([ROLE_EDIT_DELETE_OWN])
      .callsFake(async () => [roleEditDeleteOwn()]);
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  const update = (userId, id, changes) =>
    h
      .api()
      .put(`/api/${TENANT}/bookings`)
      .set(h.as(userId))
      .send(adminForm(h.stored(id), changes));

  const remove = (userId, id) =>
    h.api().delete(`/api/${TENANT}/bookings/${id}`).set(h.as(userId));

  it("keeps the owner when an editor with updateAny and deleteOwn enters their own mail, and the delete finds no own booking", async function () {
    const booking = await h.manualBooking("room");
    expect(h.stored(booking.id).assignedUserId).to.equal(CUSTOMER);

    const put = await update(EDITOR, booking.id, { mail: EDITOR });

    expect(put.status).to.equal(201);
    expect(h.stored(booking.id).assignedUserId).to.equal(CUSTOMER);

    const del = await remove(EDITOR, booking.id);

    expect(del.status).to.equal(404);
    expect(h.stored(booking.id)).to.be.ok;
  });

  it("still moves the booking to a corrected address that is not the editor's", async function () {
    const booking = await h.manualBooking("room");

    const put = await update(EDITOR, booking.id, {
      mail: "max@example.test",
    });

    expect(put.status).to.equal(201);
    expect(h.stored(booking.id).assignedUserId).to.equal("max@example.test");
  });

  it("moves the booking to the editor who may delete every booking anyway", async function () {
    const booking = await h.manualBooking("room");

    const put = await update(ADMIN, booking.id, { mail: ADMIN });

    expect(put.status).to.equal(201);
    expect(h.stored(booking.id).assignedUserId).to.equal(ADMIN);
  });
});
