const { expect } = require("chai");
const sinon = require("sinon");

const IfbsAccessProvider = require("../src/commons/services/access/providers/ifbs-access-provider");
const IfbsApiError = require("../src/commons/services/locker/clients/ifbs-api-error");

describe("IfbsAccessProvider.getStatus", () => {
  let sandbox;
  let provider;
  let client;

  const bookingContext = {
    tenant: "tenant-1",
    externalBookingId: "booking-17",
    timeBegin: 1_000,
    timeEnd: 2_000,
    accessFrom: 1_000,
    accessTo: 2_000,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = new IfbsAccessProvider();
    client = {
      monitorOpenBox: sandbox.stub(),
    };

    sandbox.stub(provider, "_getClient").resolves(client);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("returns usage window status when no open process is known", async () => {
    sandbox.useFakeTimers({ now: 1_500 });

    const status = await provider.getStatus({}, bookingContext);

    expect(status).to.deep.include({
      bookingId: "booking-17",
      usageState: "active",
      state: "active",
      open: null,
      locked: null,
      doorOpen: null,
    });
    expect(client.monitorOpenBox.called).to.equal(false);
  });

  it("polls monitorOpenBox when lastOpenBoxId is present", async () => {
    sandbox.useFakeTimers({ now: 1_500 });
    client.monitorOpenBox.resolves({
      OpenBox_ID: "9",
      BoxControlReceived: "true",
      BoxControlConfirmed: "true",
      BoxControlReceivedDateTime: "2018-11-21 13:42:38",
      BoxControlConfirmedDateTime: "2018-11-21 13:42:40",
    });

    const status = await provider.getStatus(
      {},
      { ...bookingContext, lastOpenBoxId: "9" },
    );

    expect(client.monitorOpenBox.calledOnce).to.equal(true);
    expect(client.monitorOpenBox.firstCall.args).to.deep.equal(["9"]);
    expect(status).to.deep.include({
      openProcessId: "9",
      confirmed: true,
      confirmedAt: "2018-11-21 13:42:40",
      boxControlReceived: true,
      receivedAt: "2018-11-21 13:42:38",
      open: true,
      state: "open",
      usageState: "active",
    });
  });

  it("falls back to usage window when the open process no longer exists", async () => {
    sandbox.useFakeTimers({ now: 3_000 });
    client.monitorOpenBox.rejects(
      new IfbsApiError("monitorOpenBox.php", {
        ErrNo: 1802,
        ErrMsg: "OpenBox-process not found",
      }),
    );

    const status = await provider.getStatus(
      {},
      { ...bookingContext, lastOpenBoxId: "9" },
    );

    expect(status).to.deep.include({
      bookingId: "booking-17",
      usageState: "expired",
      state: "expired",
    });
  });
});
