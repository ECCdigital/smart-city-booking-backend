/**
 * Marks the process as a test run before any spec file loads (see
 * `.mocharc.yml`). The `Booking` entity throws on a write to a derived flag
 * only here; in production it logs and keeps the state.
 */
process.env.NODE_ENV = "test";
