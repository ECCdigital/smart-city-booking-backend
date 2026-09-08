const { BaseError } = require("./BaseError");

/**
 * A provisioning run that did not get every grant it was asked for, while
 * the ones it could get were granted and stored.
 *
 * A door or compartment its provider cannot serve - a lock that does not
 * support the access point's mode, a locker provider that grants no
 * compartments - is skipped rather than aborting the run, so the rest of
 * the booking is still provisioned. The run then throws this at the end:
 * the failure stands in the access audit log per access point, the
 * lifecycle records the effect (`access.provision` is a recorded
 * operation), and the tenant gets the fault notice (glossary
 * "Störungsmitteilung"). Without it the booking would be paid and
 * confirmed, the door shut, and nobody told.
 */
class AccessProvisionError extends BaseError {
  /**
   * @param {{ accessPointId: string, reason: string }[]} failures The
   *   access points that were skipped, and why
   * @param {Object} [params]
   */
  constructor(failures, params = {}) {
    super("provision_incomplete", 409, params);
    this.name = "AccessProvisionError";
    this.failures = failures;
    this.message = failures
      .map(({ accessPointId, reason }) => `${accessPointId}: ${reason}`)
      .join("; ");
  }
}

module.exports = AccessProvisionError;
