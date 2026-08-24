const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

describe("StudentService — profile (get/update)", () => {
  let sandbox;
  let UserManager;
  let StudentManager;
  let StudentService;
  let userObj;
  let currentStudent;
  let guardianMail;

  const userId = "lena@example.de";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    userObj = {
      id: userId,
      firstName: "Alt",
      lastName: "Name",
      phone: "0431 000000",
      address: "Altstraße 1",
      zipCode: "24103",
      city: "Kiel",
    };
    currentStudent = {
      userId,
      birthDate: "2008-03-14",
      school: "Alte Schule",
      grade: "9",
      targetGroups: ["pupil"],
      created: 111,
    };
    UserManager = {
      getUser: sandbox.stub().callsFake(async () => userObj),
      getUserBy: sandbox.stub().callsFake(async () => userObj),
      updateUser: sandbox.stub().resolves(),
    };
    StudentManager = {
      getStudentByUser: sandbox.stub().callsFake(async () => currentStudent),
      storeStudent: sandbox.stub().callsFake(async (s) => {
        currentStudent = s;
        return s;
      }),
    };
    guardianMail = sandbox.stub().resolves();
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/data-managers/student-manager", StudentManager);
    mock("../../src/commons/services/student/guardian-consent-mail", {
      sendGuardianConsentRequest: guardianMail,
    });
    StudentService = mock.reRequire(
      "../../src/commons/services/student/student-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("getStudentProfile merges user Stammdaten + student extension", async () => {
    const dto = await StudentService.getStudentProfile(userId);
    expect(dto).to.deep.equal({
      email: userId,
      firstName: "Alt",
      lastName: "Name",
      street: "Altstraße 1",
      postalCode: "24103",
      city: "Kiel",
      phone: "0431 000000",
      birthDate: "2008-03-14",
      school: "Alte Schule",
      grade: "9",
      targetGroups: ["pupil"],
    });
    expect(UserManager.getUserBy.calledWith({ id: userId }, false)).to.equal(
      true,
    );
  });

  it("getStudentProfile returns an empty extension when no student row exists", async () => {
    StudentManager.getStudentByUser.callsFake(async () => null);
    const dto = await StudentService.getStudentProfile(userId);
    expect(dto.birthDate).to.equal("");
    expect(dto.school).to.equal("");
    expect(dto.targetGroups).to.deep.equal([]);
    expect(dto.email).to.equal(userId);
  });

  it("getStudentProfile → 404 when the user does not exist", async () => {
    UserManager.getUserBy.callsFake(async () => null);
    let err;
    try {
      await StudentService.getStudentProfile(userId);
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
  });

  it("updateStudentProfile updates User + student fields incl. birthDate/targetGroups", async () => {
    const dto = await StudentService.updateStudentProfile(userId, {
      firstName: "Neu",
      lastName: "Name",
      street: "Neustraße 2",
      postalCode: "24105",
      city: "Kiel",
      phone: "0431 111222",
      school: "Neue Schule",
      grade: "11",
      birthDate: "2007-05-20",
      targetGroups: ["student", "career_changer"],
    });

    expect(UserManager.updateUser.calledOnce).to.equal(true);
    expect(userObj.firstName).to.equal("Neu");
    expect(userObj.address).to.equal("Neustraße 2");
    expect(userObj.zipCode).to.equal("24105");

    const stored = StudentManager.storeStudent.firstCall.args[0];
    expect(stored.birthDate).to.equal("2007-05-20");
    expect(stored.targetGroups).to.deep.equal(["student", "career_changer"]);
    expect(stored.school).to.equal("Neue Schule");
    expect(stored.grade).to.equal("11");
    expect(stored.created).to.equal(111);

    expect(dto.firstName).to.equal("Neu");
    expect(dto.street).to.equal("Neustraße 2");
    expect(dto.school).to.equal("Neue Schule");
    expect(dto.birthDate).to.equal("2007-05-20");
    expect(dto.targetGroups).to.deep.equal(["student", "career_changer"]);

    // Regression: the row to mutate is resolved by EXACT id (getUserBy), not the fuzzy regex getUser.
    expect(UserManager.getUserBy.calledWith({ id: userId }, true)).to.equal(
      true,
    );
  });

  it("updateStudentProfile keeps a pending guardian consent intact", async () => {
    const requiredUntil = Date.now() + 31536000000;
    currentStudent.guardianEmail = "mutter@example.de";
    currentStudent.guardianConsentRequiredUntil = requiredUntil;
    currentStudent.guardianConsentAt = null;
    currentStudent.guardianConsentTokenHash = "hash";
    currentStudent.guardianConsentSentAt = 222;

    await StudentService.updateStudentProfile(userId, {
      firstName: "Lena",
      lastName: "Petersen",
      street: "Holtenauer Str. 142",
      postalCode: "24105",
      city: "Kiel",
      phone: "0431 1234567",
      birthDate: "2008-03-14",
      targetGroups: ["pupil"],
      guardianEmail: "",
      guardianConsentAt: Date.now(),
    });

    const saved = StudentManager.storeStudent.lastCall.args[0];
    expect(saved.guardianEmail).to.equal("mutter@example.de");
    expect(saved.guardianConsentRequiredUntil).to.equal(requiredUntil);
    expect(saved.guardianConsentAt).to.be.null;
    expect(saved.guardianConsentTokenHash).to.equal("hash");
    expect(saved.guardianConsentSentAt).to.equal(222);
  });

  it("updateStudentProfile cannot lift the gate by editing birthDate", async () => {
    const requiredUntil = Date.now() + 31536000000;
    currentStudent.guardianEmail = "mutter@example.de";
    currentStudent.guardianConsentRequiredUntil = requiredUntil;
    currentStudent.guardianConsentAt = null;

    await StudentService.updateStudentProfile(userId, {
      firstName: "Lena",
      lastName: "Petersen",
      street: "Holtenauer Str. 142",
      postalCode: "24105",
      city: "Kiel",
      phone: "0431 1234567",
      birthDate: "1990-01-01",
      targetGroups: ["pupil"],
    });

    const saved = StudentManager.storeStudent.lastCall.args[0];
    expect(saved.birthDate).to.equal("1990-01-01");
    expect(saved.guardianConsentRequiredUntil).to.equal(requiredUntil);
    expect(saved.guardianConsentAt).to.be.null;
  });

  it("updateStudentProfile starts the consent flow when moving under 16", async () => {
    currentStudent.birthDate = "2000-03-14";
    currentStudent.guardianConsentRequiredUntil = null;
    currentStudent.guardianConsentAt = null;

    await StudentService.updateStudentProfile(userId, {
      firstName: "Lena",
      lastName: "Petersen",
      street: "Holtenauer Str. 142",
      postalCode: "24105",
      city: "Kiel",
      phone: "0431 1234567",
      birthDate: "2015-03-14",
      targetGroups: ["pupil"],
      guardianEmail: "Mutter@Example.DE",
    });

    const saved = StudentManager.storeStudent.lastCall.args[0];
    expect(saved.birthDate).to.equal("2015-03-14");
    expect(saved.guardianEmail).to.equal("mutter@example.de");
    expect(saved.guardianConsentRequiredUntil).to.equal(Date.UTC(2031, 2, 14));
    expect(saved.guardianConsentAt).to.be.null;
    expect(saved.guardianConsentTokenHash).to.be.a("string").with.length(64);
    expect(guardianMail.calledOnce).to.be.true;
    expect(guardianMail.firstCall.args[0].sendTo).to.equal("mutter@example.de");
  });

  it("updateStudentProfile demands a guardian email when moving under 16", async () => {
    currentStudent.birthDate = "2000-03-14";
    currentStudent.guardianEmail = "";
    currentStudent.guardianConsentRequiredUntil = null;

    let err;
    try {
      await StudentService.updateStudentProfile(userId, {
        firstName: "Lena",
        lastName: "Petersen",
        street: "Holtenauer Str. 142",
        postalCode: "24105",
        city: "Kiel",
        phone: "0431 1234567",
        birthDate: "2015-03-14",
        targetGroups: ["pupil"],
      });
    } catch (e) {
      err = e;
    }

    expect(err).to.have.property("status", 400);
    expect(StudentManager.storeStudent.called).to.be.false;
  });

  it("updateStudentProfile reuses a guardian already on file", async () => {
    currentStudent.birthDate = "2000-03-14";
    currentStudent.guardianEmail = "mutter@example.de";
    currentStudent.guardianConsentRequiredUntil = Date.now() - 1000;
    currentStudent.guardianConsentAt = null;

    await StudentService.updateStudentProfile(userId, {
      firstName: "Lena",
      lastName: "Petersen",
      street: "Holtenauer Str. 142",
      postalCode: "24105",
      city: "Kiel",
      phone: "0431 1234567",
      birthDate: "2015-03-14",
      targetGroups: ["pupil"],
    });

    const saved = StudentManager.storeStudent.lastCall.args[0];
    expect(saved.guardianEmail).to.equal("mutter@example.de");
    expect(saved.guardianConsentAt).to.be.null;
  });

  it("updateStudentProfile lets a consented student change age freely", async () => {
    const consentedAt = Date.now() - 5000;
    currentStudent.birthDate = "2012-05-10";
    currentStudent.guardianEmail = "mutter@example.de";
    currentStudent.guardianConsentRequiredUntil = Date.UTC(2028, 4, 10);
    currentStudent.guardianConsentAt = consentedAt;

    await StudentService.updateStudentProfile(userId, {
      firstName: "Lena",
      lastName: "Petersen",
      street: "Holtenauer Str. 142",
      postalCode: "24105",
      city: "Kiel",
      phone: "0431 1234567",
      birthDate: "2014-01-20",
      targetGroups: ["pupil"],
    });

    const saved = StudentManager.storeStudent.lastCall.args[0];
    expect(saved.birthDate).to.equal("2014-01-20");
    expect(saved.guardianConsentAt).to.equal(consentedAt);
    expect(saved.guardianConsentRequiredUntil).to.equal(Date.UTC(2030, 0, 20));
    expect(guardianMail.called).to.be.false;
  });

  it("updateStudentProfile validates birthDate + targetGroups (400)", async () => {
    let err;
    try {
      await StudentService.updateStudentProfile(userId, {
        firstName: "Neu",
        lastName: "Name",
        street: "Neustraße 2",
        postalCode: "24105",
        city: "Kiel",
        phone: "0431 111222",
        birthDate: "not-a-date",
        targetGroups: [],
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("updateStudentProfile validates Stammdaten (400)", async () => {
    let err;
    try {
      await StudentService.updateStudentProfile(userId, {
        firstName: "Neu",
        lastName: "Name",
        street: "Neustraße 2",
        postalCode: "241",
        city: "Kiel",
        phone: "0431 111222",
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("updateStudentProfile → 404 when the caller has no student profile", async () => {
    StudentManager.getStudentByUser.callsFake(async () => null);
    let err;
    try {
      await StudentService.updateStudentProfile(userId, {
        firstName: "Neu",
        lastName: "Name",
        street: "Neustraße 2",
        postalCode: "24105",
        city: "Kiel",
        phone: "0431 111222",
        birthDate: "2007-05-20",
        targetGroups: ["student"],
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("updateStudentProfile → 400 for a future birthDate", async () => {
    let err;
    try {
      await StudentService.updateStudentProfile(userId, {
        firstName: "Neu",
        lastName: "Name",
        street: "Neustraße 2",
        postalCode: "24105",
        city: "Kiel",
        phone: "0431 111222",
        birthDate: "2999-01-01",
        targetGroups: ["student"],
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(400);
    expect(UserManager.updateUser.called).to.equal(false);
  });

  it("updateStudentProfile → 404 when the user does not exist", async () => {
    UserManager.getUserBy.callsFake(async () => null);
    let err;
    try {
      await StudentService.updateStudentProfile(userId, {
        firstName: "Neu",
        lastName: "Name",
        street: "Neustraße 2",
        postalCode: "24105",
        city: "Kiel",
        phone: "0431 111222",
        birthDate: "2007-05-20",
        targetGroups: ["student"],
      });
    } catch (e) {
      err = e;
    }
    expect(err && err.status).to.equal(404);
  });
});

describe("StudentController — profile (getMe/updateMe)", () => {
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
      getStudentProfile: sandbox.stub().resolves({ email: "lena@example.de" }),
      updateStudentProfile: sandbox
        .stub()
        .resolves({ email: "lena@example.de", firstName: "Neu" }),
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

  it("getMe returns 200 with the acting user's own profile", async () => {
    const r = res();
    await StudentController.getMe(
      { params: { tenant: "kielregion" }, user: { id: "lena@example.de" } },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(
      StudentService.getStudentProfile.calledWith("lena@example.de"),
    ).to.equal(true);
  });

  it("updateMe returns 200 and uses the JWT user id (own-scoped)", async () => {
    const r = res();
    await StudentController.updateMe(
      {
        params: { tenant: "kielregion" },
        user: { id: "lena@example.de" },
        body: { firstName: "Neu" },
      },
      r,
    );
    expect(r.statusCode).to.equal(200);
    expect(StudentService.updateStudentProfile.firstCall.args[0]).to.equal(
      "lena@example.de",
    );
  });

  it("maps a service error to its status", async () => {
    StudentService.getStudentProfile.rejects({ message: "nope", status: 404 });
    const r = res();
    await StudentController.getMe(
      { params: { tenant: "kielregion" }, user: { id: "x@y.de" } },
      r,
    );
    expect(r.statusCode).to.equal(404);
  });
});
