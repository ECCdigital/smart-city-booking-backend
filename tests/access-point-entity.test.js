const { expect } = require("chai");

const {
  AccessPoint,
  AccessPointMode,
  AccessPointType,
  VALIDATION_RULE_TYPES,
} = require("../src/commons/entities/access/access-point");
const {
  accessPointSchemaDefinition,
} = require("../src/commons/schemas/accessPointSchema");
const { ValidationError } = require("../src/errors/ValidationError");

function createParams(overrides = {}) {
  return {
    tenantId: "tenant-1",
    provider: "nuki",
    externalId: "lock-1",
    label: "Haupteingang",
    ...overrides,
  };
}

describe("AccessPoint entity", () => {
  describe("create", () => {
    it("assigns a server-side id when none is given", () => {
      const accessPoint = AccessPoint.create(createParams());

      expect(accessPoint.id).to.be.a("string").with.length.above(0);
    });

    it("keeps a given id so migrated points stay joinable", () => {
      const accessPoint = AccessPoint.create(
        createParams({ id: "legacy-point-1" }),
      );

      expect(accessPoint.id).to.equal("legacy-point-1");
    });

    it("generates an opaque, url-safe scan code", () => {
      const accessPoint = AccessPoint.create(createParams());

      expect(accessPoint.scanCode).to.match(/^[A-Za-z0-9_-]{16,}$/);
    });

    it("never takes a scan code from its caller", () => {
      const accessPoint = AccessPoint.create(
        createParams({ scanCode: "caller-chosen-code" }),
      );

      expect(accessPoint.scanCode).to.not.equal("caller-chosen-code");
    });

    it("generates a different scan code for every access point", () => {
      const codes = new Set(
        Array.from({ length: 50 }, () =>
          AccessPoint.create(createParams()),
        ).map((accessPoint) => accessPoint.scanCode),
      );

      expect(codes.size).to.equal(50);
    });

    it("starts without previously rotated scan codes", () => {
      const accessPoint = AccessPoint.create(createParams());

      expect(accessPoint.previousScanCodes).to.deep.equal([]);
    });

    it("defaults to a door in authorization mode", () => {
      const accessPoint = AccessPoint.create(createParams());

      expect(accessPoint.type).to.equal(AccessPointType.DOOR);
      expect(accessPoint.mode).to.equal(AccessPointMode.AUTHORIZATION);
    });

    it("requires a qr scan when validationRules are omitted", () => {
      const accessPoint = AccessPoint.create(createParams());

      expect(accessPoint.validationRules).to.deep.equal([
        { type: VALIDATION_RULE_TYPES.QR_SCAN },
      ]);
    });

    it("keeps an explicitly empty validationRules list empty", () => {
      const accessPoint = AccessPoint.create(
        createParams({ validationRules: [] }),
      );

      expect(accessPoint.validationRules).to.deep.equal([]);
    });

    it("leaves the location unset", () => {
      const accessPoint = AccessPoint.create(createParams());

      expect(accessPoint.location).to.equal(null);
    });

    it("does not share mutable defaults between access points", () => {
      const first = AccessPoint.create(createParams());
      const second = AccessPoint.create(createParams());

      first.config.someKey = "value";
      first.validationRules.push({ type: VALIDATION_RULE_TYPES.QR_SCAN });
      first.previousScanCodes.push("old-code");

      expect(second.config).to.deep.equal({});
      expect(second.validationRules).to.have.length(1);
      expect(second.previousScanCodes).to.deep.equal([]);
    });

    it("rejects an access point without a provider", () => {
      expect(() => AccessPoint.create(createParams({ provider: undefined })))
        .to.throw(ValidationError)
        .that.has.nested.property("errors[0].field", "provider");
    });

    it("rejects an unknown mode", () => {
      expect(() => AccessPoint.create(createParams({ mode: "telepathy" })))
        .to.throw(ValidationError)
        .that.has.nested.property("errors[0].code", "invalid_enum");
    });

    it("rejects an unknown type", () => {
      expect(() => AccessPoint.create(createParams({ type: "gate" })))
        .to.throw(ValidationError)
        .that.has.nested.property("errors[0].field", "type");
    });

    it("rejects an unknown validation rule type", () => {
      expect(() =>
        AccessPoint.create(
          createParams({ validationRules: [{ type: "faceScan" }] }),
        ),
      )
        .to.throw(ValidationError)
        .that.has.nested.property("errors[0].field", "validationRules");
    });

    it("accepts coordinates without an address", () => {
      const location = {
        coordinates: { type: "Point", points: [7.1, 51.2] },
      };

      const accessPoint = AccessPoint.create(createParams({ location }));

      expect(accessPoint.location).to.deep.equal(location);
    });

    it("rejects a location that is not an object", () => {
      expect(() => AccessPoint.create(createParams({ location: "" })))
        .to.throw(ValidationError)
        .that.has.nested.property("errors[0].field", "location");
    });

    it("rejects validationRules that are not a list", () => {
      expect(() =>
        AccessPoint.create(createParams({ validationRules: "qrScan" })),
      ).to.throw(ValidationError);
    });
  });

  describe("constructor", () => {
    it("ignores properties that are not part of the access point", () => {
      const accessPoint = new AccessPoint({
        ...createParams(),
        _id: "mongo-object-id",
        __v: 3,
        somethingElse: true,
      });

      expect(accessPoint).to.not.have.property("_id");
      expect(accessPoint).to.not.have.property("__v");
      expect(accessPoint).to.not.have.property("somethingElse");
    });

    it("carries metadata as a runtime-only field", () => {
      const accessPoint = new AccessPoint(createParams());

      expect(accessPoint.metadata).to.deep.equal({});
      expect(accessPointSchemaDefinition).to.not.have.property("metadata");
    });
  });

  describe("toDocument", () => {
    it("keeps the scan codes, they are persisted", () => {
      const accessPoint = AccessPoint.create(createParams());

      expect(accessPoint.toDocument()).to.include.keys(
        "scanCode",
        "previousScanCodes",
      );
    });

    it("leaves the runtime metadata out", () => {
      const accessPoint = AccessPoint.create(createParams());
      accessPoint.metadata = { capabilities: ["remote"] };

      expect(accessPoint.toDocument()).to.not.have.property("metadata");
    });
  });

  describe("toResponse", () => {
    it("hides the scan code and the previously rotated codes", () => {
      const accessPoint = AccessPoint.create(createParams());
      accessPoint.previousScanCodes = ["rotated-code"];

      const response = accessPoint.toResponse();

      expect(response).to.not.have.property("scanCode");
      expect(response).to.not.have.property("previousScanCodes");
    });

    it("leaves the runtime metadata out", () => {
      const accessPoint = AccessPoint.create(createParams());
      accessPoint.metadata = { capabilities: ["remote"] };

      expect(accessPoint.toResponse()).to.not.have.property("metadata");
    });

    it("keeps the fields the management API is about", () => {
      const accessPoint = AccessPoint.create(
        createParams({ providerLocationId: "site-1" }),
      );

      expect(accessPoint.toResponse()).to.include({
        id: accessPoint.id,
        tenantId: "tenant-1",
        type: AccessPointType.DOOR,
        provider: "nuki",
        externalId: "lock-1",
        providerLocationId: "site-1",
        label: "Haupteingang",
        mode: AccessPointMode.AUTHORIZATION,
      });
    });
  });
});
