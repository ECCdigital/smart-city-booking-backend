/**
 * The Öffnungsart vocabulary the platform records: which way a door was
 * opened, and where that choice came from. Provider-neutral - the access log
 * schema, the audit export and the providers that name an Öffnungsart (Nuki)
 * all read the words from here, so an open is recorded the same wherever it
 * surfaces. A provider's raw action number is its own business and stays in
 * the log payload.
 */
const OPEN_ACTIONS = Object.freeze({
  UNLOCK: "unlock",
  UNLATCH: "unlatch",
  LOCK_N_GO: "lock_n_go",
  LOCK_N_GO_UNLATCH: "lock_n_go_unlatch",
});

// Where the Öffnungsart that was sent came from: the access point says it,
// the device type decides it, or the device could not be read and the open
// fell back to unlocking.
const OPEN_ACTION_ORIGINS = Object.freeze({
  CONFIGURED: "configured",
  DEVICE_TYPE: "device_type",
  FALLBACK: "fallback",
});

module.exports = {
  OPEN_ACTIONS,
  OPEN_ACTION_ORIGINS,
};
