const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("StudentService — registerStudent", () => {
  let sandbox;
  let UserManager;
  let UserService;
  let TenantManager;
  let StudentManager;
  let StudentService;

  const validPayload = () => ({
    email: "Lena@Example.de",
    password: "Passwort1",
    firstName: "Lena",
    lastName: "Petersen",
    street: "Holtenauer Str. 142",
    postalCode: "24105",
    city: "Kiel",
    phone: "0431 1234567",
    birthDate: "2008-03-14",
    school: "Gymnasium Wellingdorf",
    grade: "10. Klasse",
    targetGroups: ["pupil"],
    consents: { privacyConsent: true, consent: true },
  });

  const reject = async (payload) => {
    let err;
    try {
      await StudentService.registerStudent("kielregion", payload);
    } catch (e) {
      err = e;
    }
    return err;
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    UserManager = { getUserBy: sandbox.stub().resolves(null) };
    UserService = { singUpUser: sandbox.stub().resolves() };
    TenantManager = {
      getTenant: sandbox.stub().resolves({ id: "kielregion" }),
    };
    StudentManager = { storeStudent: sandbox.stub().callsFake(async (s) => s) };
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/services/user-service", UserService);
    mock("../../src/commons/data-managers/tenant-manager", TenantManager);
    mock("../../src/commons/data-managers/student-manager", StudentManager);
    StudentService = mock.reRequire(
      "../../src/commons/services/student/student-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("creates the user + student row for a valid payload", async () => {
    const res = await StudentService.registerStudent(
      "kielregion",
      validPayload(),
    );
    expect(UserService.singUpUser.calledOnce).to.equal(true);
    const userArg = UserService.singUpUser.firstCall.args[0];
    expect(userArg.id).to.equal("lena@example.de");
    expect(userArg.firstName).to.equal("Lena");
    expect(userArg.address).to.equal("Holtenauer Str. 142");
    expect(userArg.zipCode).to.equal("24105");
    expect(userArg.city).to.equal("Kiel");
    expect(userArg.secret).to.be.a("string").and.not.equal("");
    expect(StudentManager.storeStudent.calledOnce).to.equal(true);
    const s = StudentManager.storeStudent.firstCall.args[0];
    expect(s.userId).to.equal("lena@example.de");
    expect(s.birthDate).to.equal("2008-03-14");
    expect(s.school).to.equal("Gymnasium Wellingdorf");
    expect(s.targetGroups).to.deep.equal(["pupil"]);
    expect(res.id).to.equal("lena@example.de");
  });

  it("accepts multiple target groups", async () => {
    const p = validPayload();
    p.targetGroups = ["pupil", "career_changer"];
    await StudentService.registerStudent("kielregion", p);
    const s = StudentManager.storeStudent.firstCall.args[0];
    expect(s.targetGroups).to.deep.equal(["pupil", "career_changer"]);
  });

  it("rejects a duplicate email (409) without creating anything", async () => {
    UserManager.getUserBy.resolves({ id: "lena@example.de" });
    const err = await reject(validPayload());
    expect(err && err.status).to.equal(409);
    expect(UserService.singUpUser.called).to.equal(false);
    expect(StudentManager.storeStudent.called).to.equal(false);
  });

  it("rejects a weak password (400)", async () => {
    const p = validPayload();
    p.password = "short";
    expect((await reject(p)).status).to.equal(400);
  });

  it("rejects a missing or invalid birth date (400)", async () => {
    const missing = validPayload();
    missing.birthDate = "";
    expect((await reject(missing)).status).to.equal(400);
    const impossible = validPayload();
    impossible.birthDate = "2008-13-40";
    expect((await reject(impossible)).status).to.equal(400);
    const rolledOver = validPayload();
    rolledOver.birthDate = "2008-02-30";
    expect((await reject(rolledOver)).status).to.equal(400);
  });

  it("rejects no target group (400)", async () => {
    const p = validPayload();
    p.targetGroups = [];
    expect((await reject(p)).status).to.equal(400);
  });

  it("rejects an unknown target group (400)", async () => {
    const p = validPayload();
    p.targetGroups = ["hacker"];
    expect((await reject(p)).status).to.equal(400);
  });

  it("rejects missing consents (400)", async () => {
    const p = validPayload();
    p.consents = { privacyConsent: true, consent: false };
    expect((await reject(p)).status).to.equal(400);
  });

  it("rejects a missing tenant (404)", async () => {
    TenantManager.getTenant.resolves(null);
    expect((await reject(validPayload())).status).to.equal(404);
  });
});

describe("StudentController — register", () => {
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
      registerStudent: sandbox.stub().resolves({ id: "lena@example.de" }),
    };
    mock("../../src/commons/services/student/student-service", StudentService);
    StudentController = mock.reRequire(
      "../../src/platform/api/controllers/student-controller",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("returns 201 with the new id", async () => {
    const r = res();
    await StudentController.register(
      { params: { tenant: "kielregion" }, body: {} },
      r,
    );
    expect(r.statusCode).to.equal(201);
    expect(r.body).to.deep.equal({ id: "lena@example.de" });
  });

  it("maps a service error to its status", async () => {
    StudentService.registerStudent.rejects({
      message: "Email already in use",
      status: 409,
    });
    const r = res();
    await StudentController.register(
      { params: { tenant: "kielregion" }, body: {} },
      r,
    );
    expect(r.statusCode).to.equal(409);
    expect(r.body).to.equal("Email already in use");
  });
});
