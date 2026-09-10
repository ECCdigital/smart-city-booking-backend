const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("Admin students", () => {
  let sandbox;

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("StudentController — authz + wiring", () => {
    let CompanyController;
    let StudentService;
    let StudentController;

    const res = () => {
      const r = { statusCode: 200, body: undefined };
      r.status = (c) => {
        r.statusCode = c;
        return r;
      };
      r.send = (b) => {
        r.body = b;
        return r;
      };
      r.sendStatus = (c) => {
        r.statusCode = c;
        return r;
      };
      return r;
    };
    const req = (over = {}) => ({
      params: { tenant: "kg", userId: "s@example.com" },
      body: {},
      user: { id: "admin@example.com" },
      ...over,
    });

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      CompanyController = { isTenantAdmin: sandbox.stub().resolves(true) };
      StudentService = {
        adminListStudents: sandbox
          .stub()
          .resolves([{ email: "s@example.com" }]),
        adminGetStudent: sandbox.stub().resolves({ email: "s@example.com" }),
        adminUpdateStudent: sandbox.stub().resolves({ email: "s@example.com" }),
        blockStudent: sandbox.stub().resolves({ isSuspended: true }),
        unblockStudent: sandbox.stub().resolves({ isSuspended: false }),
        adminDeleteStudent: sandbox
          .stub()
          .resolves({ deleted: "s@example.com" }),
        adminListStudentApplications: sandbox.stub().resolves([]),
      };
      mock(
        "../../src/platform/api/controllers/company-controller",
        CompanyController,
      );
      mock(
        "../../src/commons/services/student/student-service",
        StudentService,
      );
      StudentController = mock.reRequire(
        "../../src/platform/api/controllers/student-controller",
      );
    });

    const handlers = [
      ["adminList", "adminListStudents"],
      ["adminGet", "adminGetStudent"],
      ["adminUpdate", "adminUpdateStudent"],
      ["adminBlock", "blockStudent"],
      ["adminUnblock", "unblockStudent"],
      ["adminDelete", "adminDeleteStudent"],
      ["adminListApplications", "adminListStudentApplications"],
    ];

    handlers.forEach(([handler, service]) => {
      it(`${handler} -> 403 for a non-admin (service not called)`, async () => {
        CompanyController.isTenantAdmin.resolves(false);
        const r = res();
        await StudentController[handler](req(), r);
        expect(r.statusCode).to.equal(403);
        expect(StudentService[service].called).to.equal(false);
      });

      it(`${handler} -> 200 + delegates for an admin`, async () => {
        const r = res();
        await StudentController[handler](req(), r);
        expect(r.statusCode).to.equal(200);
        expect(StudentService[service].calledOnce).to.equal(true);
      });
    });

    it("adminGet -> propagates a 404 from the service", async () => {
      StudentService.adminGetStudent.rejects({
        message: "Student not found",
        status: 404,
      });
      const r = res();
      await StudentController.adminGet(req(), r);
      expect(r.statusCode).to.equal(404);
    });
  });

  describe("StudentService — admin logic", () => {
    let StudentManager;
    let UserManager;
    let ApplicationManager;
    let OfferBookmarkManager;
    let MembershipManager;
    let JwtHelper;
    let ApplicationService;
    let StudentService;

    const user = (over = {}) => ({
      id: "s@example.com",
      firstName: "Sam",
      lastName: "Student",
      address: "Weg 1",
      zipCode: "24103",
      city: "Kiel",
      phone: "0431123456",
      isVerified: true,
      isSuspended: false,
      created: 111,
      legalAcceptance: { dataProtection: true },
      ...over,
    });
    const student = (over = {}) => ({
      userId: "s@example.com",
      tenantId: "kg",
      birthDate: "2008-01-01",
      school: "GS",
      grade: "9",
      targetGroups: ["pupil"],
      created: 111,
      ...over,
    });

    const expectStatus = async (fn, status) => {
      let error;
      try {
        await fn();
      } catch (e) {
        error = e;
      }
      expect(error && error.status).to.equal(status);
    };

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      StudentManager = {
        getStudentByUser: sandbox.stub(),
        listStudents: sandbox.stub().resolves([]),
        removeStudent: sandbox.stub().resolves(),
        storeStudent: sandbox.stub().resolves(),
      };
      UserManager = {
        getUsersById: sandbox.stub().resolves([]),
        getUserBy: sandbox.stub().resolves(null),
        updateUser: sandbox.stub().resolves(),
        deleteUser: sandbox.stub().resolves(),
      };
      ApplicationManager = { countByStudents: sandbox.stub().resolves({}) };
      OfferBookmarkManager = { removeByUser: sandbox.stub().resolves() };
      MembershipManager = {
        removeMembership: sandbox.stub().resolves(),
        getMembershipsByUserID: sandbox.stub().resolves([]),
      };
      JwtHelper = { revokeAllUserTokens: sandbox.stub().resolves() };
      ApplicationService = {
        deleteByStudent: sandbox.stub().resolves(),
        listMyApplications: sandbox.stub().resolves([{ id: "a1" }]),
      };
      mock("../../src/commons/data-managers/student-manager", StudentManager);
      mock("../../src/commons/data-managers/user-manager", UserManager);
      mock(
        "../../src/commons/data-managers/application-manager",
        ApplicationManager,
      );
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
        "../../src/commons/services/student/application-service",
        ApplicationService,
      );
      StudentService = mock.reRequire(
        "../../src/commons/services/student/student-service",
      );
    });

    it("adminListStudents -> hydrates users + application counts, omits consents", async () => {
      StudentManager.listStudents.resolves([student()]);
      UserManager.getUsersById.resolves([user()]);
      ApplicationManager.countByStudents.resolves({ "s@example.com": 3 });
      const rows = await StudentService.adminListStudents("kg");
      expect(rows).to.have.length(1);
      expect(rows[0].email).to.equal("s@example.com");
      expect(rows[0].applicationCount).to.equal(3);
      expect(rows[0].isVerified).to.equal(true);
      expect(rows[0]).to.not.have.property("legalAcceptance");
    });

    it("adminGetStudent -> full DTO incl. consents; 404 on tenant mismatch; never leaks secret", async () => {
      StudentManager.getStudentByUser.resolves(student({ tenantId: "other" }));
      await expectStatus(
        () => StudentService.adminGetStudent("kg", "s@example.com"),
        404,
      );

      StudentManager.getStudentByUser.resolves(student());
      UserManager.getUserBy.resolves(user());
      ApplicationManager.countByStudents.resolves({ "s@example.com": 1 });
      const dto = await StudentService.adminGetStudent("kg", "s@example.com");
      expect(dto.isSuspended).to.equal(false);
      expect(dto.applicationCount).to.equal(1);
      expect(dto.legalAcceptance).to.deep.equal({ dataProtection: true });
      expect(dto).to.not.have.property("secret");
    });

    it("blockStudent -> suspends + revokes tokens; unblock does not revoke", async () => {
      StudentManager.getStudentByUser.resolves(student());
      UserManager.getUserBy.resolves(user());
      await StudentService.blockStudent("kg", "s@example.com");
      expect(UserManager.updateUser.called).to.equal(true);
      expect(UserManager.updateUser.firstCall.args[0].isSuspended).to.equal(
        true,
      );
      expect(JwtHelper.revokeAllUserTokens.calledOnce).to.equal(true);

      JwtHelper.revokeAllUserTokens.resetHistory();
      await StudentService.unblockStudent("kg", "s@example.com");
      expect(JwtHelper.revokeAllUserTokens.called).to.equal(false);
    });

    it("adminDeleteStudent -> cascade + 404 on tenant mismatch", async () => {
      StudentManager.getStudentByUser.resolves(student({ tenantId: "other" }));
      await expectStatus(
        () => StudentService.adminDeleteStudent("kg", "s@example.com"),
        404,
      );

      StudentManager.getStudentByUser.resolves(student());
      MembershipManager.getMembershipsByUserID.resolves([]);
      const result = await StudentService.adminDeleteStudent(
        "kg",
        "s@example.com",
      );
      expect(result).to.deep.equal({ deleted: "s@example.com" });
      expect(OfferBookmarkManager.removeByUser.calledOnce).to.equal(true);
      expect(ApplicationService.deleteByStudent.calledOnce).to.equal(true);
      expect(StudentManager.removeStudent.calledOnce).to.equal(true);
      expect(JwtHelper.revokeAllUserTokens.calledOnce).to.equal(true);
      expect(UserManager.deleteUser.calledOnce).to.equal(true);
    });

    it("adminListStudentApplications -> tenant-checks then reuses listMyApplications", async () => {
      StudentManager.getStudentByUser.resolves(student());
      const apps = await StudentService.adminListStudentApplications(
        "kg",
        "s@example.com",
      );
      expect(apps).to.deep.equal([{ id: "a1" }]);
      expect(
        ApplicationService.listMyApplications.calledWith("kg", "s@example.com"),
      ).to.equal(true);
    });
  });
});
