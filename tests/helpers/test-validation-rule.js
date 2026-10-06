const {
  registerValidationRule,
} = require("../../src/commons/services/access/access-validation-rules");

/**
 * A validation rule that exists only for the tests, registered so the rule
 * framework can be exercised with something `qrScan` is not: a rule with a
 * precondition at the access point.
 *
 * Registering is idempotent per type, so every test file that needs the rule may
 * require this helper.
 */
const TEST_GEO_RULE = "test-geo-fence";

registerValidationRule({
  type: TEST_GEO_RULE,
  requires: ["location"],
  verify: (evidence) => evidence.inside === true,
});

module.exports = { TEST_GEO_RULE };
