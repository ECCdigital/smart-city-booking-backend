const { expect } = require("chai");

const AccessEvidenceService = require("../src/commons/services/access/access-evidence-service");
const { TEST_GEO_RULE: GEO_RULE } = require("./helpers/test-validation-rule");

function accessPointWith(overrides = {}) {
  return {
    id: "door-1",
    tenantId: "tenant-1",
    scanCode: "current-code",
    previousScanCodes: ["retired-code"],
    validationRules: [{ type: "qrScan" }],
    ...overrides,
  };
}

describe("AccessEvidenceService.findUnmetPreconditions", () => {
  it("passes a rule whose preconditions are met", () => {
    const unmet = AccessEvidenceService.findUnmetPreconditions(
      accessPointWith({
        location: { display_address: "Rathaus" },
        validationRules: [{ type: GEO_RULE }],
      }),
    );

    expect(unmet).to.deep.equal([]);
  });

  it("names the rule and what it needs when a precondition is unmet", () => {
    const unmet = AccessEvidenceService.findUnmetPreconditions(
      accessPointWith({
        location: null,
        validationRules: [{ type: GEO_RULE }],
      }),
    );

    expect(unmet).to.deep.equal([
      { ruleType: GEO_RULE, requires: ["location"] },
    ]);
  });

  it("treats an empty field as not set", () => {
    const unmet = AccessEvidenceService.findUnmetPreconditions(
      accessPointWith({
        location: {},
        validationRules: [{ type: GEO_RULE }],
      }),
    );

    expect(unmet).to.deep.equal([
      { ruleType: GEO_RULE, requires: ["location"] },
    ]);
  });

  it("accepts qrScan on any access point", () => {
    const unmet = AccessEvidenceService.findUnmetPreconditions(
      accessPointWith({ location: null }),
    );

    expect(unmet).to.deep.equal([]);
  });

  it("leaves unknown rule types to the schema validation", () => {
    const unmet = AccessEvidenceService.findUnmetPreconditions(
      accessPointWith({ validationRules: [{ type: "retiredRule" }] }),
    );

    expect(unmet).to.deep.equal([]);
  });
});
