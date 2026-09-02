const { expect } = require("chai");

const {
  decide,
  satisfy,
  demandedEvidenceOf,
} = require("../src/commons/services/access/access-decision");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-blocking-reasons");
const { Booking } = require("../src/commons/entities/booking/booking");
const {
  AccessPointMode,
} = require("../src/commons/entities/access/access-point");
const { TEST_GEO_RULE: GEO_RULE } = require("./helpers/test-validation-rule");

const MINUTE = 60 * 1000;
const NOW = 150 * MINUTE;

/** A committed, paid booking of `user-1`, in progress at `NOW`. */
function booking(overrides = {}) {
  return new Booking({
    id: "booking-1",
    tenantId: "tenant-1",
    assignedUserId: "user-1",
    mail: "owner@example.com",
    isCommitted: true,
    isPayed: true,
    priceEur: 0,
    timeBegin: 100 * MINUTE,
    timeEnd: 200 * MINUTE,
    bookableItems: [{ bookableId: "room" }],
    ...overrides,
  });
}

/**
 * A door as the resolver hands it to the decision: the access point and the
 * booking context it was resolved with.
 */
function door(accessPoint = {}, bookingContext = {}) {
  return {
    accessPoint: {
      id: "door-1",
      tenantId: "tenant-1",
      type: "door",
      provider: "nuki",
      mode: AccessPointMode.REMOTE,
      scanCode: "current-code",
      previousScanCodes: ["retired-code"],
      validationRules: [{ type: "qrScan" }],
      ...accessPoint,
    },
    bookingContext: {
      accessBuffer: { beforeMs: 0, afterMs: 0 },
      isProvisioned: true,
      grant: null,
      revokedAt: null,
      ...bookingContext,
    },
  };
}

function locker(bookingContext = {}) {
  return {
    accessPoint: {
      id: "box-7",
      tenantId: "tenant-1",
      type: "locker",
      provider: "ifbs",
      mode: AccessPointMode.REMOTE,
    },
    bookingContext: {
      accessBuffer: { beforeMs: 0, afterMs: 0 },
      ...bookingContext,
    },
  };
}

const OWNER = { userId: "user-1" };
const OWNER_WHO_MAY_MANAGE = { userId: "user-1", canManage: true };
const MANAGER = { userId: "manager-9", canManage: true };
const STRANGER = { userId: "stranger-3" };
const NOBODY = { userId: null };

describe("Access decision: decide", () => {
  const cases = [
    {
      name: "refuses a rejected booking to its booker, with the reason first",
      booking: booking({ isRejected: true }),
      accessPoints: [door()],
      person: OWNER,
      expected: {
        accessRole: "booker",
        canView: false,
        canOperate: false,
        blockingReasons: [ACCESS_BLOCKING_REASONS.REJECTED],
        primaryBlockingReason: ACCESS_BLOCKING_REASONS.REJECTED,
        operableAccessPointIds: [],
      },
    },
    {
      name: "refuses an uncommitted booking",
      booking: booking({ isCommitted: false }),
      accessPoints: [door()],
      person: OWNER,
      expected: {
        canView: false,
        canOperate: false,
        primaryBlockingReason: ACCESS_BLOCKING_REASONS.NOT_COMMITTED,
      },
    },
    {
      name: "refuses a priced booking that is not paid",
      booking: booking({ priceEur: 25, isPayed: false }),
      accessPoints: [door()],
      person: OWNER,
      expected: {
        canView: false,
        canOperate: false,
        primaryBlockingReason: ACCESS_BLOCKING_REASONS.PAYMENT_REQUIRED,
      },
    },
    {
      name: "lets the booker view a valid booking before its window opens, but not operate",
      booking: booking(),
      accessPoints: [
        door({}, { accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 } }),
      ],
      person: OWNER,
      now: 80 * MINUTE,
      expected: {
        canView: true,
        canOperate: false,
        canOperateRemote: false,
        blockingReasons: [ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW],
        operableAccessPointIds: [],
        remoteOperableAccessPointIds: [],
      },
    },
    {
      name: "lets the booker operate within the lead-time buffer of the door",
      booking: booking(),
      accessPoints: [
        door({}, { accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 } }),
      ],
      person: OWNER,
      now: 90 * MINUTE,
      expected: {
        canOperate: true,
        canOperateRemote: true,
        blockingReasons: [],
        primaryBlockingReason: null,
        operableAccessPointIds: ["door-1"],
        remoteOperableAccessPointIds: ["door-1"],
      },
    },
    {
      name: "judges the window per door, each with its own buffer",
      booking: booking(),
      accessPoints: [
        door(
          { id: "door-1" },
          { accessBuffer: { beforeMs: 15 * MINUTE, afterMs: 0 } },
        ),
        door({ id: "door-2" }),
      ],
      person: OWNER,
      now: 90 * MINUTE,
      expected: {
        canOperate: true,
        blockingReasons: [],
        operableAccessPointIds: ["door-1"],
        remoteOperableAccessPointIds: ["door-1"],
      },
    },
    {
      name: "locks a door that only takes a code until it is granted, and says it is not provisioned",
      booking: booking(),
      accessPoints: [
        door({ mode: AccessPointMode.AUTHORIZATION }, { isProvisioned: false }),
      ],
      person: OWNER,
      expected: {
        canOperate: false,
        canOperateRemote: false,
        canUseAuthorization: false,
        blockingReasons: [
          ACCESS_BLOCKING_REASONS.NOT_PROVISIONED,
          ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
        ],
        operableAccessPointIds: [],
        remoteOperableAccessPointIds: [],
      },
    },
    {
      name: "treats a provisioned door without a grant as not provisioned",
      booking: booking(),
      accessPoints: [
        door(
          { mode: AccessPointMode.AUTHORIZATION },
          { isProvisioned: true, grant: null },
        ),
      ],
      person: OWNER,
      expected: {
        canOperate: false,
        canUseAuthorization: false,
        blockingReasons: [
          ACCESS_BLOCKING_REASONS.NOT_PROVISIONED,
          ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
        ],
        operableAccessPointIds: [],
      },
    },
    {
      name: "locks a door that only takes a code once its grant is revoked",
      booking: booking(),
      accessPoints: [
        door(
          { mode: AccessPointMode.AUTHORIZATION },
          {
            isProvisioned: true,
            grant: { authorizationId: "auth-1" },
            revokedAt: NOW - MINUTE,
          },
        ),
      ],
      person: OWNER,
      expected: {
        canOperate: false,
        canUseAuthorization: false,
        blockingReasons: [
          ACCESS_BLOCKING_REASONS.AUTHORIZATION_REVOKED,
          ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS,
        ],
        operableAccessPointIds: [],
      },
    },
    {
      name: "keeps an unprovisioned door operable where it can also be opened remotely",
      booking: booking(),
      accessPoints: [
        door({ mode: AccessPointMode.BOTH }, { isProvisioned: false }),
      ],
      person: OWNER,
      expected: {
        canOperate: true,
        canOperateRemote: true,
        canUseAuthorization: false,
        blockingReasons: [ACCESS_BLOCKING_REASONS.NOT_PROVISIONED],
        operableAccessPointIds: ["door-1"],
        remoteOperableAccessPointIds: ["door-1"],
      },
    },
    {
      name: "reports a revoked authorization as a hint, the door stays operable",
      booking: booking(),
      accessPoints: [
        door(
          { mode: AccessPointMode.BOTH },
          {
            isProvisioned: true,
            grant: { authorizationId: "auth-1" },
            revokedAt: NOW - MINUTE,
          },
        ),
      ],
      person: OWNER,
      expected: {
        canOperate: true,
        canOperateRemote: true,
        canUseAuthorization: false,
        blockingReasons: [ACCESS_BLOCKING_REASONS.AUTHORIZATION_REVOKED],
        operableAccessPointIds: ["door-1"],
        remoteOperableAccessPointIds: ["door-1"],
      },
    },
    {
      name: "enables the authorization of a provisioned door with a grant",
      booking: booking(),
      accessPoints: [
        door(
          { mode: AccessPointMode.AUTHORIZATION },
          { isProvisioned: true, grant: { authorizationId: "auth-1" } },
        ),
      ],
      person: OWNER,
      expected: {
        canOperate: true,
        canUseAuthorization: true,
        canOperateRemote: false,
        blockingReasons: [ACCESS_BLOCKING_REASONS.NO_REMOTE_ACCESS],
        operableAccessPointIds: ["door-1"],
        remoteOperableAccessPointIds: [],
      },
    },
    {
      name: "locks only the door that takes a code where the other door of the booking opens remotely",
      booking: booking(),
      accessPoints: [
        door(
          { id: "door-1", mode: AccessPointMode.AUTHORIZATION },
          { isProvisioned: false },
        ),
        door({ id: "door-2", mode: AccessPointMode.REMOTE }),
      ],
      person: OWNER,
      expected: {
        canOperate: true,
        canOperateRemote: true,
        blockingReasons: [ACCESS_BLOCKING_REASONS.NOT_PROVISIONED],
        operableAccessPointIds: ["door-2"],
        remoteOperableAccessPointIds: ["door-2"],
      },
    },
    {
      name: "says nothing about remote access where a door of the booking can be opened remotely",
      booking: booking(),
      accessPoints: [
        door(
          { id: "door-1", mode: AccessPointMode.AUTHORIZATION },
          { isProvisioned: true, grant: { authorizationId: "auth-1" } },
        ),
        door({ id: "door-2", mode: AccessPointMode.REMOTE }),
      ],
      person: OWNER,
      expected: {
        canUseAuthorization: true,
        canOperateRemote: true,
        blockingReasons: [],
        operableAccessPointIds: ["door-1", "door-2"],
        remoteOperableAccessPointIds: ["door-2"],
      },
    },
    {
      name: "takes a locker as provisioned by its existence",
      booking: booking(),
      accessPoints: [locker()],
      person: OWNER,
      expected: {
        canOperate: true,
        canOperateRemote: true,
        blockingReasons: [],
        operableAccessPointIds: ["box-7"],
        remoteOperableAccessPointIds: ["box-7"],
      },
    },
    {
      name: "lets the management operate a booking that is not theirs, waiving the evidence",
      booking: booking(),
      accessPoints: [door()],
      person: MANAGER,
      expected: {
        accessRole: "manager",
        canView: true,
        canOperate: true,
        evidenceWaived: true,
        demandedEvidence: { "door-1": [] },
      },
    },
    {
      name: "holds the booker to the evidence even where they may manage the bookings",
      booking: booking(),
      accessPoints: [door()],
      person: OWNER_WHO_MAY_MANAGE,
      expected: {
        accessRole: "booker",
        evidenceWaived: false,
        demandedEvidence: { "door-1": ["qrScan"] },
      },
    },
    {
      name: "gives a stranger no role, no view, no operation and no reason",
      booking: booking(),
      accessPoints: [door()],
      person: STRANGER,
      expected: {
        accessRole: null,
        canView: false,
        canOperate: false,
        evidenceWaived: false,
        blockingReasons: [],
        primaryBlockingReason: null,
        operableAccessPointIds: [],
        demandedEvidence: { "door-1": ["qrScan"] },
      },
    },
    {
      name: "does not tell a stranger that the window is closed",
      booking: booking(),
      accessPoints: [door()],
      person: STRANGER,
      now: 80 * MINUTE,
      expected: {
        canOperate: false,
        blockingReasons: [],
      },
    },
    {
      name: "makes a manager of nobody in particular who may manage the bookings",
      booking: booking(),
      accessPoints: [door()],
      person: { userId: null, canManage: true },
      expected: {
        accessRole: "manager",
        canView: true,
      },
    },
    {
      name: "gives nobody in particular no role",
      booking: booking(),
      accessPoints: [door()],
      person: NOBODY,
      expected: {
        accessRole: null,
        canView: false,
      },
    },
    {
      name: "answers a booking without access points with a view and nothing to operate",
      booking: booking(),
      accessPoints: [],
      person: OWNER,
      expected: {
        canView: true,
        canOperate: false,
        canOperateRemote: false,
        blockingReasons: [],
        operableAccessPointIds: [],
        demandedEvidence: {},
      },
    },
    {
      name: "demands the rule types of each door from the booker, deduplicated, and nothing of a locker",
      booking: booking(),
      accessPoints: [
        door({
          id: "door-1",
          validationRules: [{ type: "qrScan" }, { type: "qrScan" }],
        }),
        door({
          id: "door-2",
          validationRules: [{ type: GEO_RULE }, { type: "qrScan" }],
        }),
        door({ id: "door-3", validationRules: [] }),
        locker(),
      ],
      person: OWNER,
      expected: {
        demandedEvidence: {
          "door-1": ["qrScan"],
          "door-2": [GEO_RULE, "qrScan"],
          "door-3": [],
          "box-7": [],
        },
      },
    },
  ];

  for (const { name, booking, accessPoints, person, now, expected } of cases) {
    it(name, () => {
      const decision = decide(booking, accessPoints, {
        ...person,
        now: now ?? NOW,
      });

      for (const [field, value] of Object.entries(expected)) {
        expect(decision[field], field).to.deep.equal(value);
      }
    });
  }

  it("answers the complete decision in the shape the API hands out", () => {
    const decision = decide(booking(), [door()], { ...OWNER, now: NOW });

    expect(decision).to.deep.equal({
      accessRole: "booker",
      canView: true,
      canOperate: true,
      canOperateRemote: true,
      canUseAuthorization: false,
      blockingReasons: [],
      primaryBlockingReason: null,
      operableAccessPointIds: ["door-1"],
      remoteOperableAccessPointIds: ["door-1"],
      evidenceWaived: false,
      demandedEvidence: { "door-1": ["qrScan"] },
    });
  });

  it("decides for now when no point in time is given", () => {
    const now = Date.now();
    const decision = decide(
      booking({ timeBegin: now - MINUTE, timeEnd: now + MINUTE }),
      [door()],
      OWNER,
    );

    expect(decision.canOperate).to.be.true;
  });
});

describe("Access decision: satisfy", () => {
  const asBooker = decide(booking(), [door()], { ...OWNER, now: NOW });
  const asManager = decide(booking(), [door()], { ...MANAGER, now: NOW });

  function judge(accessPointOverrides = {}, evidence, decision = asBooker) {
    return satisfy(decision, door(accessPointOverrides).accessPoint, evidence);
  }

  it("requires nothing when the access point configures no rules", () => {
    expect(judge({ validationRules: [] }, [])).to.deep.equal({
      satisfied: true,
      bypassed: false,
      blockingReasons: [],
      validatedEvidence: [],
    });
  });

  it("requires nothing of a door that carries no rules field", () => {
    expect(judge({ validationRules: undefined }, []).satisfied).to.be.true;
  });

  it("accepts a scan of the current code", () => {
    const outcome = judge({}, [{ type: "qrScan", scanCode: "current-code" }]);

    expect(outcome.satisfied).to.be.true;
    expect(outcome.validatedEvidence).to.deep.equal(["qrScan"]);
    expect(outcome.blockingReasons).to.deep.equal([]);
  });

  it("rejects a scan of a rotated-out code as invalid", () => {
    const outcome = judge({}, [{ type: "qrScan", scanCode: "retired-code" }]);

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
    expect(outcome.validatedEvidence).to.deep.equal([]);
  });

  it("rejects a scan of a code that belongs to another access point", () => {
    const outcome = judge({}, [
      { type: "qrScan", scanCode: "code-of-another-door" },
    ]);

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
  });

  it("reports missing evidence when the client sent none", () => {
    const outcome = judge({}, []);

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
    ]);
  });

  it("reports missing evidence when the client sent no evidence field at all", () => {
    expect(judge({}, undefined).blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
    ]);
  });

  it("treats evidence without a usable scan code as invalid, not missing", () => {
    expect(judge({}, [{ type: "qrScan" }]).blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
  });

  it("ignores evidence of unknown types", () => {
    const outcome = judge({}, [
      { type: "smokeSignal", value: "puff" },
      { type: "qrScan", scanCode: "current-code" },
    ]);

    expect(outcome.satisfied).to.be.true;
    expect(outcome.validatedEvidence).to.deep.equal(["qrScan"]);
  });

  it("keeps only the first evidence of a type and ignores the rest", () => {
    const outcome = judge({}, [
      { type: "qrScan", scanCode: "current-code" },
      { type: "qrScan", scanCode: "retired-code" },
    ]);

    expect(outcome.satisfied).to.be.true;
  });

  it("ignores entries that are not evidence objects", () => {
    const outcome = judge({}, [
      null,
      "qrScan",
      { scanCode: "current-code" },
      { type: "qrScan", scanCode: "current-code" },
    ]);

    expect(outcome.satisfied).to.be.true;
  });

  it("requires every configured rule to be fulfilled", () => {
    const outcome = judge(
      {
        location: { display_address: "Rathaus" },
        validationRules: [{ type: "qrScan" }, { type: GEO_RULE }],
      },
      [{ type: "qrScan", scanCode: "current-code" }],
    );

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
    ]);
    expect(outcome.validatedEvidence).to.deep.equal([]);
  });

  it("lists every fulfilled rule when all of them pass", () => {
    const outcome = judge(
      {
        location: { display_address: "Rathaus" },
        validationRules: [{ type: "qrScan" }, { type: GEO_RULE }],
      },
      [
        { type: "qrScan", scanCode: "current-code" },
        { type: GEO_RULE, inside: true },
      ],
    );

    expect(outcome.satisfied).to.be.true;
    expect(outcome.validatedEvidence).to.deep.equal(["qrScan", GEO_RULE]);
  });

  it("fails closed when a configured rule has no implementation", () => {
    const outcome = judge({ validationRules: [{ type: "retiredRule" }] }, [
      { type: "retiredRule", proof: "anything" },
    ]);

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
    ]);
  });

  it("fails closed when a rule's precondition is no longer met", () => {
    const outcome = judge(
      { location: null, validationRules: [{ type: GEO_RULE }] },
      [{ type: GEO_RULE, inside: true }],
    );

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
    ]);
  });

  it("reports the reasons of several failing rules in priority order", () => {
    const outcome = judge(
      {
        location: null,
        validationRules: [{ type: "qrScan" }, { type: GEO_RULE }],
      },
      [{ type: "qrScan", scanCode: "retired-code" }],
    );

    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
      ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID,
    ]);
  });

  it("fails closed when the rules of the door are unknown", () => {
    const outcome = judge({ validationRules: null }, [
      { type: "qrScan", scanCode: "current-code" },
    ]);

    expect(outcome).to.deep.equal({
      satisfied: false,
      bypassed: false,
      blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE],
      validatedEvidence: [],
    });
  });

  it("waives the rules for the management and records that rules were configured", () => {
    expect(judge({}, [], asManager)).to.deep.equal({
      satisfied: true,
      bypassed: true,
      blockingReasons: [],
      validatedEvidence: [],
    });
  });

  it("records no bypass for the management when there was nothing to bypass", () => {
    const outcome = judge({ validationRules: [] }, [], asManager);

    expect(outcome.satisfied).to.be.true;
    expect(outcome.bypassed).to.be.false;
  });

  it("waives even a rule that cannot be evaluated", () => {
    const outcome = judge(
      { validationRules: [{ type: "retiredRule" }] },
      [],
      asManager,
    );

    expect(outcome.satisfied).to.be.true;
    expect(outcome.bypassed).to.be.true;
  });

  it("does not waive rules that are unknown - the door stays shut for everyone", () => {
    const outcome = judge({ validationRules: null }, [], asManager);

    expect(outcome.satisfied).to.be.false;
    expect(outcome.blockingReasons).to.deep.equal([
      ACCESS_BLOCKING_REASONS.EVIDENCE_RULE_UNAVAILABLE,
    ]);
  });

  it("asks a locker for no evidence, and records no bypass for anyone", () => {
    const box = locker().accessPoint;

    expect(satisfy(asBooker, box, [])).to.deep.equal({
      satisfied: true,
      bypassed: false,
      blockingReasons: [],
      validatedEvidence: [],
    });
    expect(satisfy(asManager, box, []).bypassed).to.be.false;
  });
});

describe("Access decision: demandedEvidenceOf", () => {
  it("lists the rule types of a stored door, deduplicated", () => {
    const { accessPoint } = door({
      validationRules: [{ type: "qrScan" }, { type: "qrScan" }],
    });

    expect(demandedEvidenceOf(accessPoint)).to.deep.equal(["qrScan"]);
  });

  it("skips rules without a type", () => {
    const { accessPoint } = door({
      validationRules: [{ type: "qrScan" }, { type: 42 }, {}, null],
    });

    expect(demandedEvidenceOf(accessPoint)).to.deep.equal(["qrScan"]);
  });

  it("demands nothing where the rules of the door are unknown", () => {
    const { accessPoint } = door({ validationRules: null });

    expect(demandedEvidenceOf(accessPoint)).to.deep.equal([]);
  });

  it("demands nothing of a locker", () => {
    expect(demandedEvidenceOf(locker().accessPoint)).to.deep.equal([]);
  });
});
