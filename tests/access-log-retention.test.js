const { expect } = require("chai");
const sinon = require("sinon");

const AccessLogService = require("../src/commons/services/access/access-log-service");
const AccessLogManager = require("../src/commons/data-managers/access-log-manager");

const DAY = 24 * 60 * 60 * 1000;

describe("Access log retention", () => {
  let sandbox;
  let insert;
  let originalRetention;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    insert = sandbox.stub(AccessLogManager, "insert").resolves({});
    originalRetention = process.env.ACCESS_LOG_RETENTION_DAYS;
  });

  afterEach(() => {
    sandbox.restore();
    if (originalRetention === undefined) {
      delete process.env.ACCESS_LOG_RETENTION_DAYS;
    } else {
      process.env.ACCESS_LOG_RETENTION_DAYS = originalRetention;
    }
  });

  it("keeps a scan entry exactly as long as any other access log", async () => {
    delete process.env.ACCESS_LOG_RETENTION_DAYS;
    const timestamp = Date.UTC(2026, 0, 15, 10, 0, 0);

    await AccessLogService.log({
      tenantId: "tenant-1",
      action: "scan",
      result: "denied",
      errorCode: "unknown_scan_code",
      timestamp,
    });

    expect(insert.firstCall.args[0].expiresAt).to.deep.equal(
      new Date(timestamp + 730 * DAY),
    );
  });

  it("applies the configured ACCESS_LOG_RETENTION_DAYS to scan entries", async () => {
    process.env.ACCESS_LOG_RETENTION_DAYS = "30";
    const timestamp = Date.UTC(2026, 0, 15, 10, 0, 0);

    await AccessLogService.log({
      tenantId: "tenant-1",
      action: "scan",
      result: "denied",
      timestamp,
    });

    expect(insert.firstCall.args[0].expiresAt).to.deep.equal(
      new Date(timestamp + 30 * DAY),
    );
  });
});
