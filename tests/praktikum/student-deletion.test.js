const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("StudentService — deleteAccount", () => {
  let sandbox;
  let UserManager;
  let StudentManager;
  let OfferBookmarkManager;
  let MembershipManager;
  let JwtHelper;
  let AccountDeletionService;
  let ApplicationService;
  let StudentService;
  const userId = "lena@example.de";
  const reason = "deletion_reason_student-praktikumsplatz-gefunden";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    UserManager = { deleteUser: sandbox.stub().resolves() };
    StudentManager = {
      getStudentByUser: sandbox
        .stub()
        .resolves({ userId, tenantId: "kielregion" }),
      removeStudent: sandbox.stub().resolves(),
    };
    OfferBookmarkManager = { removeByUser: sandbox.stub().resolves() };
    MembershipManager = {
      removeMembership: sandbox.stub().resolves(),
      getMembershipsByUserID: sandbox.stub().resolves([]),
    };
    JwtHelper = { revokeAllUserTokens: sandbox.stub().resolves() };
    AccountDeletionService = {
      assertValidReason: sandbox.stub().resolves(reason),
      increment: sandbox.stub().resolves(),
    };
    ApplicationService = {
      deleteByStudent: sandbox.stub().resolves({ removed: 0 }),
    };
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/data-managers/student-manager", StudentManager);
    mock(
      "../../src/commons/data-managers/offer-bookmark-manager",
      OfferBookmarkManager,
    );
    mock(
      "../../src/commons/data-managers/membership-manager",
      MembershipManager,
    );
    mock("../../src/commons/utilities/jwt-helper", JwtHelper);
    mock(
      "../../src/commons/services/account-deletion-service",
      AccountDeletionService,
    );
    mock(
      "../../src/commons/services/student/application-service",
      ApplicationService,
    );
    StudentService = mock.reRequire(
      "../../src/commons/services/student/student-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("validates the reason early but counts the deletion only after removing the student", async () => {
    const res = await StudentService.deleteAccount(
      "kielregion",
      userId,
      reason,
    );
    expect(
      AccountDeletionService.assertValidReason.calledWith(
        "kielregion",
        "student",
        reason,
      ),
    ).to.equal(true);
    // Validation is early (fail-fast), before anything is removed.
    expect(
      AccountDeletionService.assertValidReason.calledBefore(
        StudentManager.removeStudent,
      ),
    ).to.equal(true);
    expect(
      AccountDeletionService.increment.calledWith(
        "kielregion",
        "student",
        reason,
      ),
    ).to.equal(true);
    // The count happens only once the student row is actually gone.
    expect(
      StudentManager.removeStudent.calledBefore(
        AccountDeletionService.increment,
      ),
    ).to.equal(true);
    expect(OfferBookmarkManager.removeByUser.calledWith(userId)).to.equal(true);
    expect(ApplicationService.deleteByStudent.calledWith(userId)).to.equal(
      true,
    );
    expect(StudentManager.removeStudent.calledWith(userId)).to.equal(true);
    expect(
      MembershipManager.removeMembership.calledWith("kielregion", userId),
    ).to.equal(true);
    expect(JwtHelper.revokeAllUserTokens.calledWith(userId)).to.equal(true);
    expect(UserManager.deleteUser.calledWith(userId)).to.equal(true);
    expect(res).to.deep.equal({ deleted: userId });
  });

  it("keeps the global user when memberships remain elsewhere (still clears student data)", async () => {
    MembershipManager.getMembershipsByUserID.resolves([
      { tenantId: "other", userId },
    ]);
    await StudentService.deleteAccount("kielregion", userId, reason);
    expect(OfferBookmarkManager.removeByUser.calledWith(userId)).to.equal(true);
    expect(ApplicationService.deleteByStudent.calledWith(userId)).to.equal(
      true,
    );
    expect(StudentManager.removeStudent.calledWith(userId)).to.equal(true);
    expect(UserManager.deleteUser.called).to.equal(false);
  });

  it("→ 400 when the reason is invalid, deleting nothing", async () => {
    AccountDeletionService.assertValidReason.rejects({
      message: "A valid deletion reason is required",
      status: 400,
    });
    let err;
    try {
      await StudentService.deleteAccount("kielregion", userId, "bogus");
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(OfferBookmarkManager.removeByUser.called).to.equal(false);
    expect(ApplicationService.deleteByStudent.called).to.equal(false);
    expect(StudentManager.removeStudent.called).to.equal(false);
    expect(AccountDeletionService.increment.called).to.equal(false);
    expect(UserManager.deleteUser.called).to.equal(false);
  });

  it("→ 404 when the caller is not a student (no student record), deleting nothing", async () => {
    StudentManager.getStudentByUser.resolves(null);
    let err;
    try {
      await StudentService.deleteAccount("kielregion", userId, reason);
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    expect(AccountDeletionService.assertValidReason.called).to.equal(false);
    expect(AccountDeletionService.increment.called).to.equal(false);
    expect(OfferBookmarkManager.removeByUser.called).to.equal(false);
    expect(ApplicationService.deleteByStudent.called).to.equal(false);
    expect(UserManager.deleteUser.called).to.equal(false);
  });
});

describe("StudentController — deleteMe", () => {
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
    StudentService = {
      deleteAccount: sandbox.stub().resolves({ deleted: "lena@example.de" }),
    };
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

  it("returns 200 and forwards tenant + JWT user id + the selected reason", async () => {
    const r = res();
    await StudentController.deleteMe(
      {
        params: { tenant: "kielregion" },
        user: { id: "lena@example.de" },
        body: { reason: "deletion_reason_student-doppeltes-konto" },
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      StudentService.deleteAccount.calledWith(
        "kielregion",
        "lena@example.de",
        "deletion_reason_student-doppeltes-konto",
      ),
    ).to.equal(true);
  });

  it("maps a service error to its status", async () => {
    StudentService.deleteAccount.rejects({ message: "nope", status: 404 });
    const r = res();
    await StudentController.deleteMe(
      { params: { tenant: "kielregion" }, user: { id: "x@y.de" }, body: {} },
      r,
    );
    expect(r.statusCode).to.equal(404);
  });
});
