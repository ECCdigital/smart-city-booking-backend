const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");
const crypto = require("crypto");

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function birthDateYearsAgo(years) {
  return new Date(Date.now() - years * YEAR_MS).toISOString().slice(0, 10);
}

describe("GuardianConsentService", () => {
  let sandbox;
  let StudentManager;
  let UserManager;
  let AuditLogService;
  let mailStub;
  let GuardianConsentService;

  const storedStudent = () => StudentManager.storeStudent.lastCall.args[0];

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    StudentManager = {
      getStudentByUser: sandbox.stub().resolves(null),
      getStudentByGuardianToken: sandbox.stub().resolves(null),
      storeStudent: sandbox.stub().callsFake(async (s) => s),
    };
    UserManager = {
      getUserBy: sandbox
        .stub()
        .resolves({ id: "lena@example.de", firstName: "Lena", lastName: "P" }),
    };
    AuditLogService = { record: sandbox.stub().resolves() };
    mailStub = sandbox.stub().resolves();

    mock("../../src/commons/data-managers/student-manager", StudentManager);
    mock("../../src/commons/data-managers/user-manager", UserManager);
    mock("../../src/commons/services/audit-log-service", AuditLogService);
    mock("../../src/commons/services/student/guardian-consent-mail", {
      sendGuardianConsentRequest: mailStub,
    });
    GuardianConsentService = mock.reRequire(
      "../../src/commons/services/student/guardian-consent-service",
    );
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  describe("isRequiredFor", () => {
    it("requires consent below 16", () => {
      expect(GuardianConsentService.isRequiredFor(birthDateYearsAgo(14))).to.be
        .true;
    });

    it("does not require consent at 16 or older", () => {
      expect(GuardianConsentService.isRequiredFor(birthDateYearsAgo(16.1))).to
        .be.false;
      expect(GuardianConsentService.isRequiredFor(birthDateYearsAgo(40))).to.be
        .false;
    });
  });

  describe("isPending", () => {
    it("is false for anyone without a student record", () => {
      expect(GuardianConsentService.isPending(null)).to.be.false;
      expect(GuardianConsentService.isPending(undefined)).to.be.false;
    });

    it("is false for a student that never needed consent", () => {
      expect(
        GuardianConsentService.isPending({
          guardianConsentRequiredUntil: null,
          guardianConsentAt: null,
        }),
      ).to.be.false;
    });

    it("is true while an under-16 account is waiting", () => {
      expect(
        GuardianConsentService.isPending({
          guardianConsentRequiredUntil: Date.now() + YEAR_MS,
          guardianConsentAt: null,
        }),
      ).to.be.true;
    });

    it("is false once consent was granted", () => {
      expect(
        GuardianConsentService.isPending({
          guardianConsentRequiredUntil: Date.now() + YEAR_MS,
          guardianConsentAt: Date.now(),
        }),
      ).to.be.false;
    });

    it("lifts itself once the student turns 16", () => {
      expect(
        GuardianConsentService.isPending({
          guardianConsentRequiredUntil: Date.now() - 1000,
          guardianConsentAt: null,
        }),
      ).to.be.false;
    });
  });

  describe("buildForRegistration", () => {
    it("returns no guardian fields for a student of 16 or older", () => {
      const result = GuardianConsentService.buildForRegistration(
        birthDateYearsAgo(17),
        "",
      );
      expect(result.token).to.be.null;
      expect(result.fields).to.deep.equal({});
    });

    it("rejects a missing or invalid guardian email below 16", () => {
      const birthDate = birthDateYearsAgo(14);
      expect(() =>
        GuardianConsentService.buildForRegistration(birthDate, ""),
      ).to.throw();
      expect(() =>
        GuardianConsentService.buildForRegistration(birthDate, "not-an-email"),
      ).to.throw();
    });

    it("rejects the student's own address as the guardian's", () => {
      const birthDate = birthDateYearsAgo(14);
      expect(() =>
        GuardianConsentService.buildForRegistration(
          birthDate,
          " Lena@Example.DE ",
          "lena@example.de",
        ),
      ).to.throw();
    });

    it("stores only the hash of the token it returns", () => {
      const result = GuardianConsentService.buildForRegistration(
        birthDateYearsAgo(14),
        "  Mutter@Example.DE ",
      );
      expect(result.token).to.be.a("string").with.length.greaterThan(20);
      expect(result.fields.guardianEmail).to.equal("mutter@example.de");
      expect(result.fields.guardianConsentAt).to.be.null;
      expect(result.fields.guardianConsentTokenHash).to.equal(
        crypto.createHash("sha256").update(result.token).digest("hex"),
      );
      expect(result.fields.guardianConsentTokenHash).to.not.equal(result.token);
    });

    it("freezes the requirement at the 16th birthday", () => {
      const result = GuardianConsentService.buildForRegistration(
        "2014-03-14",
        "mutter@example.de",
      );
      expect(result.fields.guardianConsentRequiredUntil).to.equal(
        Date.UTC(2030, 2, 14),
      );
    });
  });

  describe("confirm", () => {
    it("records the consent and burns the token", async () => {
      const student = {
        userId: "lena@example.de",
        tenantId: "kielregion",
        guardianConsentRequiredUntil: Date.now() + YEAR_MS,
        guardianConsentAt: null,
        guardianConsentTokenHash: "hash",
      };
      StudentManager.getStudentByGuardianToken.resolves(student);

      const result = await GuardianConsentService.confirm(
        "kielregion",
        "raw-token",
      );

      expect(result.consentedAt).to.be.a("number");
      expect(storedStudent().guardianConsentAt).to.be.a("number");
      expect(storedStudent().guardianConsentTokenHash).to.equal("");
      expect(GuardianConsentService.isPending(storedStudent())).to.be.false;
      expect(storedStudent().guardianConsentBy).to.equal("");
      expect(AuditLogService.record.calledOnce).to.be.true;
    });

    it("looks the student up by the hash, never the raw token", async () => {
      StudentManager.getStudentByGuardianToken.resolves({
        userId: "lena@example.de",
        tenantId: "kielregion",
        guardianConsentRequiredUntil: Date.now() + YEAR_MS,
        guardianConsentAt: null,
      });
      await GuardianConsentService.confirm("kielregion", "raw-token");
      expect(
        StudentManager.getStudentByGuardianToken.firstCall.args[0],
      ).to.equal(crypto.createHash("sha256").update("raw-token").digest("hex"));
    });

    it("rejects an unknown token", async () => {
      let err;
      try {
        await GuardianConsentService.confirm("kielregion", "nope");
      } catch (e) {
        err = e;
      }
      expect(err).to.have.property("status", 404);
    });

    it("rejects a token belonging to another tenant", async () => {
      StudentManager.getStudentByGuardianToken.resolves({
        userId: "lena@example.de",
        tenantId: "other-region",
        guardianConsentRequiredUntil: Date.now() + YEAR_MS,
      });
      let err;
      try {
        await GuardianConsentService.confirm("kielregion", "raw-token");
      } catch (e) {
        err = e;
      }
      expect(err).to.have.property("status", 404);
    });

    it("rejects an empty token without touching the database", async () => {
      let err;
      try {
        await GuardianConsentService.confirm("kielregion", "");
      } catch (e) {
        err = e;
      }
      expect(err).to.have.property("status", 400);
      expect(StudentManager.getStudentByGuardianToken.called).to.be.false;
    });
  });

  describe("resend", () => {
    const pendingStudent = () => ({
      userId: "lena@example.de",
      tenantId: "kielregion",
      guardianEmail: "mutter@example.de",
      guardianConsentRequiredUntil: Date.now() + YEAR_MS,
      guardianConsentAt: null,
      guardianConsentTokenHash: "old-hash",
    });

    it("issues a new token and mails the raw value", async () => {
      StudentManager.getStudentByUser.resolves(pendingStudent());
      await GuardianConsentService.resend("kielregion", "lena@example.de");

      const mailed = mailStub.firstCall.args[0];
      expect(mailed.sendTo).to.equal("mutter@example.de");
      expect(storedStudent().guardianConsentTokenHash).to.equal(
        crypto.createHash("sha256").update(mailed.token).digest("hex"),
      );
      expect(storedStudent().guardianConsentTokenHash).to.not.equal("old-hash");
    });

    it("accepts a corrected guardian address", async () => {
      StudentManager.getStudentByUser.resolves(pendingStudent());
      await GuardianConsentService.resend(
        "kielregion",
        "lena@example.de",
        " Vater@Example.DE ",
      );
      expect(storedStudent().guardianEmail).to.equal("vater@example.de");
      expect(mailStub.firstCall.args[0].sendTo).to.equal("vater@example.de");
    });

    it("rejects a resend addressed to the student themselves", async () => {
      StudentManager.getStudentByUser.resolves(pendingStudent());
      let err;
      try {
        await GuardianConsentService.resend(
          "kielregion",
          "lena@example.de",
          "Lena@Example.de",
        );
      } catch (e) {
        err = e;
      }
      expect(err).to.have.property("status", 400);
      expect(mailStub.called).to.be.false;
    });

    it("rejects an invalid replacement address", async () => {
      StudentManager.getStudentByUser.resolves(pendingStudent());
      let err;
      try {
        await GuardianConsentService.resend(
          "kielregion",
          "lena@example.de",
          "nope",
        );
      } catch (e) {
        err = e;
      }
      expect(err).to.have.property("status", 400);
      expect(mailStub.called).to.be.false;
    });

    it("sends nothing once consent was granted", async () => {
      const student = pendingStudent();
      student.guardianConsentAt = Date.now();
      StudentManager.getStudentByUser.resolves(student);

      const result = await GuardianConsentService.resend(
        "kielregion",
        "lena@example.de",
      );
      expect(result.sent).to.be.false;
      expect(mailStub.called).to.be.false;
    });

    it("throttles a second request", async () => {
      StudentManager.getStudentByUser.resolves(pendingStudent());
      await GuardianConsentService.resend("kielregion", "lena@example.de");
      let err;
      try {
        await GuardianConsentService.resend("kielregion", "lena@example.de");
      } catch (e) {
        err = e;
      }
      expect(err).to.have.property("status", 429);
    });
  });

  describe("adminSetConsent", () => {
    const pending = () => ({
      userId: "lena@example.de",
      tenantId: "kielregion",
      guardianEmail: "mutter@example.de",
      guardianConsentRequiredUntil: Date.now() + YEAR_MS,
      guardianConsentAt: null,
      guardianConsentTokenHash: "old-hash",
    });

    it("grants consent manually and records the admin", async () => {
      StudentManager.getStudentByUser.resolves(pending());
      const status = await GuardianConsentService.adminSetConsent(
        "kielregion",
        "lena@example.de",
        "admin@kielregion.de",
        true,
      );

      expect(storedStudent().guardianConsentAt).to.be.a("number");
      expect(storedStudent().guardianConsentBy).to.equal("admin@kielregion.de");
      expect(storedStudent().guardianConsentTokenHash).to.equal("");
      expect(GuardianConsentService.isPending(storedStudent())).to.be.false;
      expect(status.required).to.be.false;
      expect(AuditLogService.record.calledOnce).to.be.true;
      expect(AuditLogService.record.firstCall.args[2]).to.contain(
        "admin@kielregion.de",
      );
    });

    it("re-gates the student when the override is withdrawn", async () => {
      const student = pending();
      student.guardianConsentAt = Date.now();
      student.guardianConsentBy = "admin@kielregion.de";
      StudentManager.getStudentByUser.resolves(student);

      await GuardianConsentService.adminSetConsent(
        "kielregion",
        "lena@example.de",
        "admin@kielregion.de",
        false,
      );

      expect(storedStudent().guardianConsentAt).to.be.null;
      expect(storedStudent().guardianConsentBy).to.equal("");
      expect(GuardianConsentService.isPending(storedStudent())).to.be.true;
    });

    it("stays inside the admin's tenant", async () => {
      const student = pending();
      student.tenantId = "other-region";
      StudentManager.getStudentByUser.resolves(student);
      let err;
      try {
        await GuardianConsentService.adminSetConsent(
          "kielregion",
          "lena@example.de",
          "admin@kielregion.de",
          true,
        );
      } catch (e) {
        err = e;
      }
      expect(err).to.have.property("status", 404);
      expect(StudentManager.storeStudent.called).to.be.false;
    });
  });

  describe("getStatus", () => {
    it("reports nothing required for a user without a student record", async () => {
      const status = await GuardianConsentService.getStatus("boss@company.de");
      expect(status).to.deep.equal({
        required: false,
        consented: false,
        guardianEmail: "",
        consentedAt: null,
        consentedBy: "",
        lastSentAt: null,
      });
    });

    it("reports a pending consent", async () => {
      StudentManager.getStudentByUser.resolves({
        guardianEmail: "mutter@example.de",
        guardianConsentRequiredUntil: Date.now() + YEAR_MS,
        guardianConsentAt: null,
      });
      const status = await GuardianConsentService.getStatus("lena@example.de");
      expect(status.required).to.be.true;
      expect(status.consented).to.be.false;
      expect(status.guardianEmail).to.equal("mutter@example.de");
    });
  });
});

describe("requireGuardianConsent middleware", () => {
  let sandbox;
  let StudentManager;
  let requireGuardianConsent;

  const runWith = async (student, user = { id: "lena@example.de" }) => {
    StudentManager.getStudentByUser.resolves(student);
    const next = sandbox.stub();
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub().returnsThis(),
      sendStatus: sandbox.stub().returnsThis(),
    };
    await requireGuardianConsent({ user }, res, next);
    return { next, res };
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    StudentManager = { getStudentByUser: sandbox.stub().resolves(null) };
    mock("../../src/commons/data-managers/student-manager", StudentManager);
    requireGuardianConsent = mock.reRequire(
      "../../src/middleware/guardian-consent-middleware",
    ).requireGuardianConsent;
  });

  afterEach(() => {
    sandbox.restore();
    mock.stopAll();
  });

  it("blocks a student waiting for consent", async () => {
    const { next, res } = await runWith({
      guardianConsentRequiredUntil: Date.now() + YEAR_MS,
      guardianConsentAt: null,
    });
    expect(next.called).to.be.false;
    expect(res.status.calledWith(403)).to.be.true;
    expect(res.json.firstCall.args[0].reason).to.equal(
      "guardian_consent_pending",
    );
  });

  it("lets a company member through — no student record", async () => {
    const { next, res } = await runWith(null, { id: "boss@company.de" });
    expect(next.calledOnce).to.be.true;
    expect(res.status.called).to.be.false;
  });

  it("lets an adult student through", async () => {
    const { next } = await runWith({
      guardianConsentRequiredUntil: null,
      guardianConsentAt: null,
    });
    expect(next.calledOnce).to.be.true;
  });

  it("lets a consented student through", async () => {
    const { next } = await runWith({
      guardianConsentRequiredUntil: Date.now() + YEAR_MS,
      guardianConsentAt: Date.now(),
    });
    expect(next.calledOnce).to.be.true;
  });

  it("does not query the database for an unauthenticated request", async () => {
    const next = sandbox.stub();
    await requireGuardianConsent({}, {}, next);
    expect(next.calledOnce).to.be.true;
    expect(StudentManager.getStudentByUser.called).to.be.false;
  });

  it("fails closed on a database error", async () => {
    StudentManager.getStudentByUser.rejects(new Error("mongo down"));
    const next = sandbox.stub();
    const res = { sendStatus: sandbox.stub().returnsThis() };
    await requireGuardianConsent(
      { user: { id: "lena@example.de" } },
      res,
      next,
    );
    expect(next.called).to.be.false;
    expect(res.sendStatus.calledWith(500)).to.be.true;
  });
});
