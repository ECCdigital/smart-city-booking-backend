const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("StudentService — resendVerification", () => {
  let sandbox;
  let StudentManager;
  let UserManager;
  let MailController;
  let StudentService;
  const tenantId = "kielregion";
  const email = "lena@example.de";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    StudentManager = {
      getStudentByUser: sandbox.stub().resolves({ userId: email }),
    };
    UserManager = {
      getUserBy: sandbox.stub().resolves({
        id: email,
        isVerified: false,
        addHook: sandbox.stub().returns({ id: "hook-1" }),
      }),
      updateUser: sandbox.stub().resolves(),
    };
    MailController = { sendVerificationRequest: sandbox.stub().resolves() };
    mock("../../src/commons/data-managers/student-manager", StudentManager);
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/mail-service/mail-controller", MailController);
    StudentService = mock.reRequire(
      "../../src/commons/services/student/student-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("re-sends the verification email for an unverified student", async () => {
    await StudentService.resendVerification(tenantId, email);
    expect(UserManager.updateUser.calledOnce).to.equal(true);
    expect(
      MailController.sendVerificationRequest.calledWith(email, "hook-1"),
    ).to.equal(true);
  });

  it("→ 400 when the email is missing", async () => {
    let err;
    try {
      await StudentService.resendVerification(tenantId, "");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(MailController.sendVerificationRequest.called).to.equal(false);
  });

  it("does nothing (no leak) when the email is not a student", async () => {
    StudentManager.getStudentByUser.resolves(null);
    await StudentService.resendVerification(tenantId, email);
    expect(MailController.sendVerificationRequest.called).to.equal(false);
  });

  it("does nothing when the account is already verified", async () => {
    UserManager.getUserBy.resolves({ id: email, isVerified: true });
    await StudentService.resendVerification(tenantId, email);
    expect(MailController.sendVerificationRequest.called).to.equal(false);
  });

  it("throttles a rapid second resend for the same email (429)", async () => {
    await StudentService.resendVerification(tenantId, email);
    let err;
    try {
      await StudentService.resendVerification(tenantId, email);
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(429);
    expect(MailController.sendVerificationRequest.callCount).to.equal(1);
  });

  it("throttles a non-existent account identically (no enumeration oracle)", async () => {
    StudentManager.getStudentByUser.resolves(null);
    await StudentService.resendVerification(tenantId, email);
    let err;
    try {
      await StudentService.resendVerification(tenantId, email);
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(429);
    expect(MailController.sendVerificationRequest.called).to.equal(false);
  });
});

describe("StudentController — resendVerification", () => {
  let sandbox;
  let StudentService;
  let StudentController;

  const res = () => ({
    statusCode: null,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    StudentService = { resendVerification: sandbox.stub().resolves() };
    mock("../../src/commons/services/student/student-service", StudentService);
    mock("../../src/commons/services/student/offer-bookmark-service", {});
    StudentController = mock.reRequire(
      "../../src/platform/api/controllers/student-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("returns 200 with a generic message (anti-enumeration)", async () => {
    const r = res();
    await StudentController.resendVerification(
      { params: { tenant: "kielregion" }, body: { email: "lena@example.de" } },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      StudentService.resendVerification.calledWith(
        "kielregion",
        "lena@example.de",
        undefined,
      ),
    ).to.equal(true);
  });

  it("maps a service error (429) to its status", async () => {
    StudentService.resendVerification.rejects({ message: "wait", status: 429 });
    const r = res();
    await StudentController.resendVerification(
      { params: { tenant: "kielregion" }, body: { email: "lena@example.de" } },
      r,
    );
    expect(r.statusCode).to.equal(429);
  });
});
