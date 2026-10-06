/**
 * Whether the migrations have run in this process, for the readiness probe
 * (tenant supervision spec §11): the server sets it around `runMigrations`,
 * `/healthz/ready` reads it. Traffic opens only once the run has succeeded;
 * a failed run keeps it closed until a corrected process starts.
 */

const MIGRATION_STATES = Object.freeze({
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
});

function createMigrationState() {
  let current = MIGRATION_STATES.PENDING;

  return {
    get: () => current,

    /**
     * Run the migrations and record the outcome; a failure is handed on.
     *
     * @param {function(): Promise<*>} run
     * @returns {Promise<*>} What `run` returns
     */
    async track(run) {
      current = MIGRATION_STATES.PENDING;
      try {
        const result = await run();
        current = MIGRATION_STATES.SUCCEEDED;
        return result;
      } catch (error) {
        current = MIGRATION_STATES.FAILED;
        throw error;
      }
    },

    /** Express middleware in front of the readiness checks. */
    readinessGate(req, res, next) {
      if (current === MIGRATION_STATES.SUCCEEDED) return next();

      res.status(503).json({
        status: "unavailable",
        details: { migrations: current },
      });
    },
  };
}

module.exports = {
  MIGRATION_STATES,
  createMigrationState,
  // The state of this process.
  migrationState: createMigrationState(),
};
