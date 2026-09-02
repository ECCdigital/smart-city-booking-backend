/**
 * The locks, IQs and booking context the access provider tests share: one
 * NUKI smart lock with a keypad, one Salto keypad lock on an IQ without OTP,
 * one iFBS location with one booked box, one Pareva size - each in the
 * shape its API lists it.
 */

const {
  NUKI_DEVICE_TYPES,
} = require("../../src/commons/services/access/clients/nuki-api-client");
const { FAKE_SITE_ID } = require("./fake-salto-ks-api-client");

const TENANT = "tenant-1";
const TENANT_MAIL = "stadt@example.test";
const MINUTE = 60 * 1000;
const SALTO_LOCK_ID = "4d77312f-4a87-41db-a97b-f9d948dcc908";
const SALTO_IQ_ID = "5dfdc54e-8335-11f0-a2ed-6045bd92d38f";
const IFBS_BOOKING_ID = "booking-17";
const IFBS_LOCATION_ID = "7";
const IFBS_BOX_NUMBER = "62100103";
const PAREVA_LOCKER_ID = "locker-1";
const PAREVA_SIZE = "S";

function nukiSmartlock(overrides = {}) {
  return {
    smartlockId: 1001,
    name: "Main door",
    type: NUKI_DEVICE_TYPES.SMART_LOCK_3_4,
    accountId: 77,
    config: { keypadPaired: true },
    state: { state: 1, doorState: 0 },
    ...overrides,
  };
}

// An IQ without OTP needs no local activation, so an open runs without the
// activation service reading the tenant.
function saltoLock(overrides = {}) {
  return {
    id: SALTO_LOCK_ID,
    customer_reference: "Tür 01",
    lock_type: "escutcheon_pin",
    online: true,
    locked_state: "locked",
    siteId: FAKE_SITE_ID,
    iq: { id: SALTO_IQ_ID, otp_enabled: false },
    ...overrides,
  };
}

function saltoIq(overrides = {}) {
  return {
    id: SALTO_IQ_ID,
    otp_enabled: false,
    restore_required: false,
    ...overrides,
  };
}

/** The tenant as `TenantManager.getTenant` answers it, with a Salto app. */
function tenantWithSaltoApp() {
  return {
    id: TENANT,
    mail: TENANT_MAIL,
    applications: [
      {
        type: "access",
        id: "salto-ks",
        active: true,
        clientId: "client-id",
        clientSecret: "client-secret",
        username: "system-user@example.test",
        password: "password",
        siteId: FAKE_SITE_ID,
        environment: "accept",
        iqActivations: [],
      },
    ],
  };
}

/** The booking context the service hands an adapter for a running booking. */
function bookingContext(overrides = {}) {
  const now = Date.now();
  return {
    tenant: TENANT,
    bookingId: "booking-1",
    timeBegin: now - 5 * MINUTE,
    timeEnd: now + 55 * MINUTE,
    accessFrom: now - 5 * MINUTE,
    accessTo: now + 55 * MINUTE,
    booking: { name: "Erika Muster", mail: "erika@example.test" },
    ...overrides,
  };
}

module.exports = {
  TENANT,
  TENANT_MAIL,
  MINUTE,
  SALTO_LOCK_ID,
  SALTO_IQ_ID,
  IFBS_BOOKING_ID,
  IFBS_LOCATION_ID,
  IFBS_BOX_NUMBER,
  PAREVA_LOCKER_ID,
  PAREVA_SIZE,
  nukiSmartlock,
  saltoLock,
  saltoIq,
  tenantWithSaltoApp,
  bookingContext,
};
