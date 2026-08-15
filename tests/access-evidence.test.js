const { expect } = require("chai");

const AccessEvidenceService = require("../src/commons/services/access/access-evidence-service");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-blocking-reasons");
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

describe("AccessEvidenceService.evaluate", () => {
  it("requires nothing when the access point configures no rules", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({ validationRules: [] }),
      [],
    );

    expect(outcome).to.deep.equal({
      satisfied: true,
      bypassed: false,
      blockingReasons: [],
      validatedEvidence: [],
    });
  });

  it("accepts a scan of the current code", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [
      { type: "qrScan", scanCode: "current-code" },
    ]);

    expect(outcome.satisfied).to.be.true;
    expect(outcome.validatedEvidence).to.deep.equal(["qrScan"]);
    expect(outcome.blockingReasons).to.deep.equal([]);
  });

  it("rejects a scan of a rotated-out code as invalid", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [
      { type: "qrScan", scanCode: "retired-code" },
    ]);

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
    expect(outcome.validatedEvidence).to.deep.equal([]);
  });

  it("rejects a scan of a code that belongs to another access point", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [
      { type: "qrScan", scanCode: "code-of-another-door" },
    ]);

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
  });

  it("reports missing evidence when the client sent none", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), []);

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
    ]);
  });

  it("reports missing evidence when the client sent no evidence field at all", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith());

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
    ]);
  });

  it("treats evidence without a usable scan code as invalid, not missing", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [
      { type: "qrScan" },
    ]);

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
  });

  it("ignores evidence of unknown types", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [
      { type: "smokeSignal", value: "puff" },
      { type: "qrScan", scanCode: "current-code" },
    ]);

    expect(outcome.satisfied).to.be.true;
    expect(outcome.validatedEvidence).to.deep.equal(["qrScan"]);
  });

  it("keeps only the first evidence of a type and ignores the rest", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [
      { type: "qrScan", scanCode: "current-code" },
      { type: "qrScan", scanCode: "retired-code" },
    ]);

    expect(outcome.satisfied).to.be.true;
  });

  it("ignores entries that are not evidence objects", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [
      null,
      "qrScan",
      { scanCode: "current-code" },
      { type: "qrScan", scanCode: "current-code" },
    ]);

    expect(outcome.satisfied).to.be.true;
  });

  it("requires every configured rule to be fulfilled", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({
        location: { display_address: "Rathaus" },
        validationRules: [{ type: "qrScan" }, { type: GEO_RULE }],
      }),
      [{ type: "qrScan", scanCode: "current-code" }],
    );

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
    ]);
    expect(outcome.validatedEvidence).to.deep.equal([]);
  });

  it("lists every fulfilled rule when all of them pass", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({
        location: { display_address: "Rathaus" },
        validationRules: [{ type: "qrScan" }, { type: GEO_RULE }],
      }),
      [
        { type: "qrScan", scanCode: "current-code" },
        { type: GEO_RULE, inside: true },
      ],
    );

    expect(outcome.satisfied).to.be.true;
    expect(outcome.validatedEvidence).to.deep.equal(["qrScan", GEO_RULE]);
  });

  it("fails closed when a configured rule has no implementation", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({ validationRules: [{ type: "retiredRule" }] }),
      [{ type: "retiredRule", proof: "anything" }],
    );

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
    ]);
  });

  it("fails closed when a rule's precondition is no longer met", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({
        location: null,
        validationRules: [{ type: GEO_RULE }],
      }),
      [{ type: GEO_RULE, inside: true }],
    );

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
    ]);
  });

  it("reports the reasons of several failing rules in priority order", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({
        location: null,
        validationRules: [{ type: "qrScan" }, { type: GEO_RULE }],
      }),
      [{ type: "qrScan", scanCode: "retired-code" }],
    );

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
  });

  it("bypasses the rules but records that rules were configured", () => {
    const outcome = AccessEvidenceService.evaluate(accessPointWith(), [], {
      bypass: true,
    });

    expect(outcome).to.deep.equal({
      satisfied: true,
      bypassed: true,
      blockingReasons: [],
      validatedEvidence: [],
    });
  });

  it("does not record a bypass when there was nothing to bypass", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({ validationRules: [] }),
      [],
      { bypass: true },
    );

    expect(outcome.bypassed).to.be.false;
  });

  it("bypasses even a rule that cannot be evaluated", () => {
    const outcome = AccessEvidenceService.evaluate(
      accessPointWith({ validationRules: [{ type: "retiredRule" }] }),
      [],
      { bypass: true },
    );

    expect(outcome.satisfied).to.be.true;
    expect(outcome.bypassed).to.be.true;
  });

  it("requires no evidence when there is no access point to ask", () => {
    const outcome = AccessEvidenceService.evaluate(null, []);

    expect(outcome.satisfied).to.be.true;
    expect(outcome.bypassed).to.be.false;
  });
});

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
