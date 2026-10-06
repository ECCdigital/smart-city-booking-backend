const { expect } = require("chai");
const sinon = require("sinon");

const AccessAuditService = require("../src/commons/services/access/access-audit-service");
const AccessAuditController = require("../src/platform/api/controllers/access-audit-controller");
const AccessLogManager = require("../src/commons/data-managers/access-log-manager");
const AccessLogModel = require("../src/commons/data-managers/models/accessLogModel");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const PdfService = require("../src/commons/pdf-service/pdf-service");
const {
  ACCESS_BLOCKING_REASONS,
} = require("../src/commons/services/access/access-blocking-reasons");
const {
  OPEN_ACTIONS,
  OPEN_ACTION_ORIGINS,
} = require("../src/commons/services/access/access-open-action");
const {
  accessLogSchemaDefinition,
} = require("../src/commons/schemas/accessLogSchema");

function createLog(overrides = {}) {
  return {
    id: "log-1",
    tenantId: "tenant-1",
    bookingId: "booking-1",
    accessPointId: "point-1",
    accessPointType: "door",
    provider: "nuki",
    externalId: "lock-1",
    action: "open",
    actor: { userId: "user-1", source: "user" },
    result: "success",
    blockingReasons: [],
    channel: null,
    accessRole: "booker",
    evidenceBypassed: false,
    payload: {},
    errorCode: null,
    errorMessage: null,
    timestamp: Date.UTC(2026, 0, 15, 10, 30, 0),
    ...overrides,
  };
}

describe("accessLogSchema Öffnungsart fields", () => {
  it("records the open action and its origin top-level, unset as null", () => {
    // Blank on an old row means "not recorded", like `evidenceBypassed`.
    expect(accessLogSchemaDefinition.openAction.default).to.equal(null);
    expect(accessLogSchemaDefinition.openAction.enum).to.deep.equal([
      "unlock",
      "unlatch",
      "lock_n_go",
      "lock_n_go_unlatch",
      null,
    ]);
    expect(accessLogSchemaDefinition.openActionOrigin.default).to.equal(null);
    expect(accessLogSchemaDefinition.openActionOrigin.enum).to.deep.equal([
      "configured",
      "device_type",
      "fallback",
      null,
    ]);
  });

  it("keeps the retired unlatch action readable", () => {
    expect(accessLogSchemaDefinition.action.enum).to.include("unlatch");
  });
});

describe("AccessAuditService export", () => {
  let sandbox;
  let query;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    query = sandbox.stub(AccessLogManager, "query").resolves([]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getAuditEntries", () => {
    it("carries blocking reasons, channel and evidence bypass as own fields", async () => {
      query.resolves([
        createLog({
          result: "denied",
          blockingReasons: [
            ACCESS_BLOCKING_REASONS.OUTSIDE_ACCESS_WINDOW,
            ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING,
          ],
          channel: "remote",
        }),
      ]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      expect(entry.blockingReasons).to.equal(
        "Außerhalb des Zeitfensters, Nachweis fehlt",
      );
      expect(entry.channel).to.equal("Fernöffnung");
      expect(entry.evidenceBypassed).to.equal("Nein");
    });

    it("marks an open that skipped the evidence rules", async () => {
      query.resolves([
        createLog({ channel: "qrScan", evidenceBypassed: true }),
      ]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      expect(entry.evidenceBypassed).to.equal("Ja");
      expect(entry.channel).to.equal("QR-Scan");
    });

    it("says in which capacity a door was opened", async () => {
      query.resolves([
        createLog({ accessRole: "manager", evidenceBypassed: true }),
      ]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      // The capacity, not the permission: this is what makes the bypass next
      // to it readable.
      expect(entry.accessRole).to.equal("Verwaltung");
    });

    it("spells out the Öffnungsart and where it came from, and keeps the raw Nuki number to the details", async () => {
      query.resolves([
        createLog({
          openAction: "unlatch",
          openActionOrigin: "device_type",
          payload: { state: "opened", openProcessId: null, nukiAction: 3 },
        }),
      ]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      expect(entry.openAction).to.equal("Falle ziehen");
      expect(entry.openActionOrigin).to.equal("nach Gerätetyp");
      expect(entry.details).to.include('"nukiAction":3');
    });

    it("names every Öffnungsart and every origin of the shared vocabulary", () => {
      // An enum value without wording would reach a compliance export as a
      // raw code; the schema enum and the label maps move together.
      expect(
        Object.keys(AccessAuditService.OPEN_ACTION_LABELS),
      ).to.have.members(Object.values(OPEN_ACTIONS));
      expect(AccessAuditService.OPEN_ACTION_LABELS).to.deep.equal({
        unlock: "Aufschließen",
        unlatch: "Falle ziehen",
        lock_n_go: "Lock'n'Go",
        lock_n_go_unlatch: "Lock'n'Go mit Falle ziehen",
      });
      expect(
        Object.keys(AccessAuditService.OPEN_ACTION_ORIGIN_LABELS),
      ).to.have.members(Object.values(OPEN_ACTION_ORIGINS));
      expect(AccessAuditService.OPEN_ACTION_ORIGIN_LABELS).to.deep.equal({
        configured: "eingestellt",
        device_type: "nach Gerätetyp",
        fallback: "Rückfall",
      });
    });

    it("leaves the Öffnungsart empty where none was recorded", async () => {
      const before = createLog();
      delete before.openAction;
      delete before.openActionOrigin;
      query.resolves([
        before,
        createLog({
          provider: "ifbs",
          openAction: null,
          openActionOrigin: null,
        }),
      ]);

      const [old, ifbs] = await AccessAuditService.getAuditEntries("tenant-1");

      // Not "Aufschließen": a row from before the field, and a provider
      // that names no Öffnungsart, both recorded nothing.
      expect(old.openAction).to.equal("");
      expect(old.openActionOrigin).to.equal("");
      expect(ifbs.openAction).to.equal("");
      expect(ifbs.openActionOrigin).to.equal("");
    });

    it("names every blocking reason of the shared vocabulary", () => {
      // Adding a reason to the vocabulary without wording for it here would
      // otherwise surface as a raw code in a compliance export.
      expect(
        Object.keys(AccessAuditService.BLOCKING_REASON_LABELS),
      ).to.have.members(Object.values(ACCESS_BLOCKING_REASONS));
    });

    it("keeps a reason it has no label for rather than dropping it", async () => {
      query.resolves([createLog({ blockingReasons: ["some_future_reason"] })]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      // An unlabelled reason is still evidence. Losing it would leave a denial
      // in the export with no explanation at all.
      expect(entry.blockingReasons).to.equal("some_future_reason");
    });

    it("leaves the new fields empty for entries written before they existed", async () => {
      const log = createLog();
      delete log.blockingReasons;
      delete log.channel;
      delete log.evidenceBypassed;
      delete log.accessRole;
      query.resolves([log]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      expect(entry.blockingReasons).to.equal("");
      expect(entry.channel).to.equal("");
      // Not "Nein": nobody recorded that the rules were not bypassed.
      expect(entry.evidenceBypassed).to.equal("");
      // Not "Buchender" either: nobody acted in a capacity here.
      expect(entry.accessRole).to.equal("");
    });

    it("leaves the capacity empty where an action has none", async () => {
      query.resolves([
        createLog({
          action: "provision",
          accessRole: null,
          actor: { userId: "user-1", source: "system" },
        }),
      ]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      // Provisioning nobody stands at the door for: the blank cell is the
      // correct statement, not a gap in the record.
      expect(entry.action).to.equal("provision");
      expect(entry.accessRole).to.equal("");
    });

    it("exports a failed scan with its error code", async () => {
      query.resolves([
        createLog({
          action: "scan",
          result: "denied",
          bookingId: null,
          payload: { presentedScanCode: "abc-123" },
          errorCode: "stale_scan_code",
        }),
      ]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      expect(entry.action).to.equal("scan");
      expect(entry.result).to.equal("denied");
      expect(entry.errorCode).to.equal("stale_scan_code");
    });

    it("keeps the presented scan code readable while redacting real secrets", async () => {
      query.resolves([
        createLog({
          action: "scan",
          payload: { presentedScanCode: "abc-123", code: "1234", pin: "0000" },
        }),
      ]);

      const [entry] = await AccessAuditService.getAuditEntries("tenant-1");

      expect(entry.details).to.include("abc-123");
      expect(entry.details).to.not.include("1234");
      expect(entry.details).to.not.include("0000");
    });

    it("passes the denied and scan filters on to the query", async () => {
      await AccessAuditService.getAuditEntries("tenant-1", {
        result: "denied",
        action: "scan",
      });

      const filters = query.firstCall.args[1];
      expect(filters.result).to.equal("denied");
      expect(filters.action).to.equal("scan");
    });

    it("reads a single day in both bounds as that whole day in Berlin time", async () => {
      await AccessAuditService.getAuditEntries("tenant-1", {
        from: "2026-09-17",
        to: "2026-09-17",
      });

      const filters = query.firstCall.args[1];
      // 17.09.2026 00:00 CEST is 16.09.2026 22:00 UTC
      expect(filters.from).to.equal(Date.UTC(2026, 8, 16, 22, 0, 0));
      expect(filters.to).to.equal(Date.UTC(2026, 8, 17, 21, 59, 59, 999));
    });

    it("keeps exact timestamps and epoch values as given", async () => {
      await AccessAuditService.getAuditEntries("tenant-1", {
        from: "2026-09-17T08:00:00.000Z",
        to: String(Date.UTC(2026, 8, 17, 9, 0, 0)),
      });

      const filters = query.firstCall.args[1];
      expect(filters.from).to.equal(Date.UTC(2026, 8, 17, 8, 0, 0));
      expect(filters.to).to.equal(Date.UTC(2026, 8, 17, 9, 0, 0));
    });

    it("drops an unreadable date rather than filtering on it", async () => {
      await AccessAuditService.getAuditEntries("tenant-1", {
        from: "2026-13-45",
        to: "gestern",
      });

      const filters = query.firstCall.args[1];
      expect(filters).to.not.have.property("from");
      expect(filters).to.not.have.property("to");
    });
  });

  describe("toCsv", () => {
    it("has its own German columns for reasons, channel and evidence bypass", async () => {
      query.resolves([
        createLog({
          result: "denied",
          blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_INVALID],
          channel: "qrScan",
          evidenceBypassed: false,
        }),
      ]);

      const entries = await AccessAuditService.getAuditEntries("tenant-1");
      const csv = AccessAuditService.toCsv(entries);
      const [header, row] = csv.replace("\uFEFF", "").split("\r\n");

      const cells = header.split(";");
      const values = row.split(";");
      const cellFor = (label) => values[cells.indexOf(label)];

      expect(cells).to.include.members([
        "Blockierungsgründe",
        "Kanal",
        "Evidence-Bypass",
      ]);
      expect(cellFor("Blockierungsgründe")).to.equal("Nachweis ungültig");
      expect(cellFor("Kanal")).to.equal("QR-Scan");
      expect(cellFor("Evidence-Bypass")).to.equal("Nein");
    });

    it("has a column for the capacity next to the bypass", async () => {
      query.resolves([
        createLog({ accessRole: "manager", evidenceBypassed: true }),
      ]);

      const entries = await AccessAuditService.getAuditEntries("tenant-1");
      const csv = AccessAuditService.toCsv(entries);
      const [header, row] = csv.replace("\uFEFF", "").split("\r\n");

      const cells = header.split(";");
      const values = row.split(";");

      expect(cells).to.include("Zugriffsrolle");
      expect(values[cells.indexOf("Zugriffsrolle")]).to.equal("Verwaltung");
      // Read together, the two cells tell an auditor why the bypass applied.
      expect(
        cells.indexOf("Zugriffsrolle") - cells.indexOf("Evidence-Bypass"),
      ).to.equal(1);
    });

    it("has the two Öffnungsart columns directly after the capacity, and no column for the Nuki number", async () => {
      query.resolves([
        createLog({
          openAction: "lock_n_go_unlatch",
          openActionOrigin: "configured",
          payload: { nukiAction: 5 },
        }),
      ]);

      const entries = await AccessAuditService.getAuditEntries("tenant-1");
      const csv = AccessAuditService.toCsv(entries);
      const [header, row] = csv.replace("\uFEFF", "").split("\r\n");

      const cells = header.split(";");
      const values = row.split(";");
      const cellFor = (label) => values[cells.indexOf(label)];

      expect(cells.indexOf("Öffnungsart")).to.equal(
        cells.indexOf("Zugriffsrolle") + 1,
      );
      expect(cells.indexOf("Herkunft der Öffnungsart")).to.equal(
        cells.indexOf("Zugriffsrolle") + 2,
      );
      expect(cellFor("Öffnungsart")).to.equal("Lock'n'Go mit Falle ziehen");
      expect(cellFor("Herkunft der Öffnungsart")).to.equal("eingestellt");
      expect(cells).to.not.include("nukiAction");
      expect(cellFor("Details")).to.include("nukiAction");
    });

    it("keeps the existing columns", () => {
      const header = AccessAuditService.toCsv([]).replace("\uFEFF", "");

      expect(header.split(";")).to.include.members([
        "Zeitpunkt",
        "Aktion",
        "Ergebnis",
        "Access-Point-ID",
        "Typ",
        "Anbieter",
        "Externe ID",
        "Buchungsnummer",
        "Benutzer",
        "Quelle",
        "Fehlercode",
        "Fehlermeldung",
        "Details",
      ]);
    });
  });

  describe("toPdf", () => {
    it("renders the new columns into the PDF table", async () => {
      sandbox.stub(TenantManager, "getTenant").resolves({ id: "tenant-1" });
      const convert = sandbox
        .stub(PdfService, "convertToPdf")
        .resolves({ buffer: Buffer.from(""), name: "audit.pdf" });

      query.resolves([
        createLog({
          result: "denied",
          blockingReasons: [ACCESS_BLOCKING_REASONS.EVIDENCE_MISSING],
          channel: "remote",
          evidenceBypassed: false,
          accessRole: "booker",
        }),
      ]);

      const entries = await AccessAuditService.getAuditEntries("tenant-1");
      await AccessAuditService.toPdf("tenant-1", entries);

      const html = convert.firstCall.args[0];
      expect(html).to.include("Blockierungsgründe");
      expect(html).to.include("Kanal");
      expect(html).to.include("Evidence-Bypass");
      expect(html).to.include("Zugriffsrolle");
      expect(html).to.include("Nachweis fehlt");
      expect(html).to.include("Fernöffnung");
      expect(html).to.include("Buchender");
      expect(html).to.not.include("evidence_missing");
    });
  });
});

describe("Access audit export filters", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("narrows the query to denied scans", async () => {
    const cursor = {
      sort: sinon.stub().returnsThis(),
      limit: sinon.stub().returnsThis(),
      lean: sinon.stub().resolves([]),
    };
    const find = sandbox.stub(AccessLogModel, "find").returns(cursor);

    await AccessLogManager.query("tenant-1", {
      result: "denied",
      action: "scan",
    });

    expect(find.firstCall.args[0]).to.deep.equal({
      tenantId: "tenant-1",
      action: "scan",
      result: "denied",
    });
  });

  it("hands the endpoint's filters to the export", async () => {
    const getAuditEntries = sandbox
      .stub(AccessAuditService, "getAuditEntries")
      .resolves([]);

    const response = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      sendStatus: sandbox.stub(),
      setHeader: sandbox.stub(),
    };

    await AccessAuditController.exportAudit(
      {
        params: { tenant: "tenant-1" },
        query: { result: "denied", action: "scan" },
        user: { id: "user-1" },
      },
      response,
    );

    const [tenantId, filters] = getAuditEntries.firstCall.args;
    expect(tenantId).to.equal("tenant-1");
    expect(filters.result).to.equal("denied");
    expect(filters.action).to.equal("scan");
    expect(response.status.calledWith(200)).to.be.true;
  });
});
