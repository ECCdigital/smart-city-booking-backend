const assert = require("assert");
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

  const unknown = { open: null, locked: null, doorOpen: null };

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

  it("knows nothing without an open process, and does not ask iFBS", async () => {
    const status = await provider.getStatus({}, bookingContext);

    expect(status).to.deep.equal(unknown);
    expect(client.monitorOpenBox.called).to.equal(false);
  });

  it("polls monitorOpenBox when lastOpenBoxId is present and answers a confirmed open as open", async () => {
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
    expect(status).to.deep.equal({ open: true, locked: false, doorOpen: null });
  });

  it("answers an open process the box has not confirmed as unknown", async () => {
    client.monitorOpenBox.resolves({
      OpenBox_ID: "9",
      BoxControlReceived: "true",
      BoxControlConfirmed: "false",
    });

    const status = await provider.getStatus(
      {},
      { ...bookingContext, lastOpenBoxId: "9" },
    );

    expect(status).to.deep.equal(unknown);
  });

  it("answers unknown when the open process no longer exists", async () => {
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

    expect(status).to.deep.equal(unknown);
  });

  it("lets any other iFBS failure through", async () => {
    client.monitorOpenBox.rejects(
      new IfbsApiError("monitorOpenBox.php", {
        ErrNo: 1000,
        ErrMsg: "Internal error",
      }),
    );

    await assert.rejects(
      provider.getStatus({}, { ...bookingContext, lastOpenBoxId: "9" }),
      IfbsApiError,
    );
  });
});
