const { expect } = require("chai");
const sinon = require("sinon");

const {
  TenantController,
} = require("../src/platform/api/controllers/tenant-controller");
const MediaReferenceGuard = require("../src/commons/services/media/media-reference-guard");
const PermissionService = require("../src/commons/services/permission-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const UserManager = require("../src/commons/data-managers/user-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const MembershipManager = require("../src/commons/data-managers/membership-manager");
const Tenant = require("../src/commons/entities/tenant/tenant");
const { BadRequestError, ForbiddenError } = require("../src/errors/BaseError");

const TENANT = "tenant1";
const MEDIA = "doc-1";
const USER = "owner@stadt.de";

function mediaReference(mediaId = MEDIA) {
  return { source: "media", mediaId, url: null };
}

function tenantFixture(legalDocuments) {
  return new Tenant({ id: TENANT, name: "Stadt", legalDocuments });
}

describe("TenantController legal documents", function () {
  let sandbox, req, res;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    req = {
      user: { id: USER },
      params: {},
      query: {},
      body: { id: TENANT },
    };
    res = {
      status: sandbox.stub().returnsThis(),
      send: sandbox.stub(),
      sendStatus: sandbox.stub(),
    };
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("updateTenant", function () {
    beforeEach(function () {
      sandbox.stub(PermissionService, "_isTenantOwner").resolves(true);
      sandbox.stub(PermissionService, "_isInstanceOwner").resolves(false);
      sandbox.stub(TenantManager, "getTenant").resolves(tenantFixture([]));
    });

    it("passes legalDocuments through to the stored tenant", async function () {
      const storeStub = sandbox
        .stub(TenantManager, "storeTenant")
        .callsFake(async (tenant) => tenant);
      sandbox.stub(MediaReferenceGuard, "assertTenantStorable").resolves();

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference() },
      ];

      await TenantController.updateTenant(req, res);

      expect(storeStub.calledOnce).to.be.true;
      expect(storeStub.firstCall.args[0].legalDocuments).to.deep.equal(
        req.body.legalDocuments,
      );
      expect(res.status.calledWith(200)).to.be.true;
    });

    it("leaves stored legalDocuments alone and unchecked when the payload omits them", async function () {
      const storeStub = sandbox
        .stub(TenantManager, "storeTenant")
        .callsFake(async (tenant) => tenant);
      const guardStub = sandbox
        .stub(MediaReferenceGuard, "assertTenantStorable")
        .resolves();

      TenantManager.getTenant.resolves(
        tenantFixture([
          { type: "legalNotice", title: "", reference: mediaReference() },
        ]),
      );

      await TenantController.updateTenant(req, res);

      expect(storeStub.firstCall.args[0].legalDocuments).to.deep.equal([
        { type: "legalNotice", title: "", reference: mediaReference() },
      ]);
      // A medium that turned intern after it was picked must not block the
      // next change to an unrelated field.
      expect(guardStub.firstCall.args[0].legalDocuments).to.be.undefined;
    });

    it("answers 400 when the list breaks a shape rule", async function () {
      const storeStub = sandbox.stub(TenantManager, "storeTenant");
      sandbox.stub(MediaReferenceGuard, "assertTenantStorable").resolves();

      req.body.legalDocuments = [{ type: "other", title: "  " }];

      await TenantController.updateTenant(req, res);

      expect(res.status.calledWith(400)).to.be.true;
      expect(storeStub.called).to.be.false;
    });

    it("checks every referenced medium in the scope of the stored tenant", async function () {
      sandbox.stub(TenantManager, "storeTenant").callsFake(async (t) => t);
      const guardStub = sandbox
        .stub(MediaReferenceGuard, "assertTenantStorable")
        .resolves();

      req.body.id = TENANT;
      req.body.legalDocuments = [
        { type: "termsAndConditions", title: "", reference: mediaReference() },
      ];

      await TenantController.updateTenant(req, res);

      expect(guardStub.calledOnce).to.be.true;
      const [checked, tenantId, userId] = guardStub.firstCall.args;
      expect(checked.legalDocuments).to.deep.equal(req.body.legalDocuments);
      expect(tenantId).to.equal(TENANT);
      expect(userId).to.equal(USER);
    });

    it("answers 400 with the code when the medium may not be referenced", async function () {
      const storeStub = sandbox.stub(TenantManager, "storeTenant");
      sandbox
        .stub(MediaReferenceGuard, "assertTenantStorable")
        .rejects(new BadRequestError("media_reference_not_public"));

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference() },
      ];

      await TenantController.updateTenant(req, res);

      expect(res.status.calledWith(400)).to.be.true;
      expect(res.send.firstCall.args[0].code).to.equal(
        "media_reference_not_public",
      );
      expect(storeStub.called).to.be.false;
    });

    it("answers 403 when the saver may not pick the medium", async function () {
      sandbox.stub(TenantManager, "storeTenant");
      sandbox
        .stub(MediaReferenceGuard, "assertTenantStorable")
        .rejects(new ForbiddenError("forbidden"));

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference() },
      ];

      await TenantController.updateTenant(req, res);

      expect(res.status.calledWith(403)).to.be.true;
    });

    it("answers the updated tenant with the resolved document URL", async function () {
      sandbox.stub(MediaReferenceGuard, "assertTenantStorable").resolves();
      sandbox
        .stub(TenantManager, "storeTenant")
        .callsFake(async (tenant) => tenant);

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference() },
      ];

      await TenantController.updateTenant(req, res);

      const sent = res.send.firstCall.args[0];
      expect(sent.legalDocuments[0].reference).to.deep.equal({
        source: "media",
        mediaId: MEDIA,
        url: `/api/v2/${TENANT}/media/${MEDIA}/file`,
      });
    });

    it("stores a full set of documents untouched and reads it back resolved", async function () {
      sandbox.stub(MediaReferenceGuard, "assertTenantStorable").resolves();
      const storeStub = sandbox
        .stub(TenantManager, "storeTenant")
        .callsFake(async (tenant) => tenant);

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference("dp") },
        { type: "legalNotice", title: "", reference: mediaReference("ln") },
        {
          type: "termsAndConditions",
          title: "",
          reference: {
            source: "external",
            mediaId: null,
            url: "https://stadt.de/agb.pdf",
          },
        },
        {
          type: "rightOfWithdrawal",
          title: "",
          reference: mediaReference("row"),
        },
        {
          type: "other",
          title: "Hausordnung",
          reference: mediaReference("ho"),
        },
      ];

      await TenantController.updateTenant(req, res);

      // Nothing is normalised on the way in.
      expect(storeStub.firstCall.args[0].legalDocuments).to.deep.equal(
        req.body.legalDocuments,
      );

      const sent = res.send.firstCall.args[0];
      expect(sent.legalDocuments.map((d) => d.type)).to.deep.equal([
        "dataProtection",
        "legalNotice",
        "termsAndConditions",
        "rightOfWithdrawal",
        "other",
      ]);
      expect(sent.legalDocuments.map((d) => d.reference.url)).to.deep.equal([
        `/api/v2/${TENANT}/media/dp/file`,
        `/api/v2/${TENANT}/media/ln/file`,
        // An external address is the platform's to resolve, not to rewrite.
        "https://stadt.de/agb.pdf",
        `/api/v2/${TENANT}/media/row/file`,
        `/api/v2/${TENANT}/media/ho/file`,
      ]);
      expect(sent.legalDocuments[4].title).to.equal("Hausordnung");
    });

    it("answers 403 for a user who owns neither tenant nor instance", async function () {
      PermissionService._isTenantOwner.resolves(false);
      const storeStub = sandbox.stub(TenantManager, "storeTenant");
      const guardStub = sandbox.stub(
        MediaReferenceGuard,
        "assertTenantStorable",
      );

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference() },
      ];

      await TenantController.updateTenant(req, res);

      expect(res.sendStatus.calledWith(403)).to.be.true;
      expect(storeStub.called).to.be.false;
      expect(guardStub.called).to.be.false;
    });
  });

  describe("createTenant", function () {
    beforeEach(function () {
      sandbox.stub(TenantManager, "checkTenantCount").resolves(true);
      sandbox.stub(MembershipManager, "addMembership").resolves();
      sandbox.stub(InstanceManager, "getInstance").resolves({
        allowAllUsersToCreateTenant: true,
        allowedUsersToCreateTenant: [],
        ownerUserIds: [],
      });
    });

    it("answers 400 when the list breaks a shape rule", async function () {
      const storeStub = sandbox.stub(TenantManager, "storeTenant");

      req.body.legalDocuments = [{ type: "unknownType", title: "" }];

      await TenantController.createTenant(req, res);

      expect(res.status.calledWith(400)).to.be.true;
      expect(storeStub.called).to.be.false;
    });

    it("checks referenced media before the tenant is created", async function () {
      const storeStub = sandbox.stub(TenantManager, "storeTenant");
      sandbox
        .stub(MediaReferenceGuard, "assertTenantStorable")
        .rejects(new BadRequestError("media_reference_unknown"));

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference() },
      ];

      await TenantController.createTenant(req, res);

      expect(res.status.calledWith(400)).to.be.true;
      expect(res.send.firstCall.args[0].code).to.equal(
        "media_reference_unknown",
      );
      expect(storeStub.called).to.be.false;
    });

    it("answers 403 before saying anything about the media of a user who may not create tenants", async function () {
      InstanceManager.getInstance.resolves({
        allowAllUsersToCreateTenant: false,
        allowedUsersToCreateTenant: [],
        ownerUserIds: [],
      });
      const guardStub = sandbox.stub(
        MediaReferenceGuard,
        "assertTenantStorable",
      );

      req.body.legalDocuments = [
        { type: "dataProtection", title: "", reference: mediaReference() },
      ];

      await TenantController.createTenant(req, res);

      expect(res.sendStatus.calledWith(403)).to.be.true;
      expect(guardStub.called).to.be.false;
    });
  });

  describe("reading", function () {
    it("sends a single tenant with the resolved document URL", async function () {
      sandbox.stub(PermissionService, "_isTenantOwner").resolves(true);
      sandbox.stub(PermissionService, "_isInstanceOwner").resolves(false);
      sandbox
        .stub(TenantManager, "getTenant")
        .resolves(
          tenantFixture([
            { type: "dataProtection", title: "", reference: mediaReference() },
          ]),
        );

      req.params.id = TENANT;

      await TenantController.getTenant(req, res);

      const sent = res.send.firstCall.args[0];
      expect(sent.legalDocuments[0].reference.url).to.equal(
        `/api/v2/${TENANT}/media/${MEDIA}/file`,
      );
    });

    it("sends the tenant list with resolved document URLs", async function () {
      sandbox.stub(PermissionService, "_isTenantOwner").resolves(true);
      sandbox.stub(PermissionService, "_isInstanceOwner").resolves(false);
      sandbox.stub(UserManager, "getUserPermissions").resolves({ tenants: [] });
      sandbox
        .stub(TenantManager, "getTenants")
        .resolves([
          tenantFixture([
            { type: "legalNotice", title: "", reference: mediaReference() },
          ]),
        ]);

      await TenantController.getTenants(req, res);

      const sent = res.send.firstCall.args[0];
      expect(sent[0].legalDocuments[0].reference.url).to.equal(
        `/api/v2/${TENANT}/media/${MEDIA}/file`,
      );
    });

    it("keeps legal documents out of the public tenant export", async function () {
      sandbox
        .stub(TenantManager, "getTenants")
        .resolves([
          tenantFixture([
            { type: "legalNotice", title: "", reference: mediaReference() },
          ]),
        ]);

      await TenantController.getPublicTenants(req, res);

      const sent = res.send.firstCall.args[0];
      expect(sent[0]).to.not.have.property("legalDocuments");
    });
  });
});
