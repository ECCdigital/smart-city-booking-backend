const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");

const { AccessPoint } = require("../src/commons/entities/access/access-point");

function createAccessPoint(overrides = {}) {
  return AccessPoint.create({
    id: "point-1",
    tenantId: "tenant-1",
    provider: "nuki",
    externalId: "lock-1",
    label: "Haupteingang",
    ...overrides,
  });
}

describe("AccessQrService", () => {
  let sandbox;
  let AccessQrService;
  let PdfService;
  let previousStoreFrontUrl;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    previousStoreFrontUrl = process.env.STORE_FRONT_URL;
    process.env.STORE_FRONT_URL = "https://store.example.com";

    PdfService = {
      convertToPdf: sandbox.stub().resolves({ buffer: Buffer.from("pdf") }),
    };
    mock("../src/commons/pdf-service/pdf-service", PdfService);

    AccessQrService = mock.reRequire(
      "../src/commons/services/access/access-qr-service.js",
    );
  });

  afterEach(() => {
    if (previousStoreFrontUrl === undefined) {
      delete process.env.STORE_FRONT_URL;
    } else {
      process.env.STORE_FRONT_URL = previousStoreFrontUrl;
    }
    sandbox.restore();
    mock.stopAll();
  });

  describe("scanUrl", () => {
    it("encodes exactly <STORE_FRONT_URL>/mobile-key/<tenant>/<scanCode>", () => {
      const url = AccessQrService.scanUrl("tenant-1", "abc123");

      expect(url).to.equal(
        "https://store.example.com/mobile-key/tenant-1/abc123",
      );
    });

    it("does not double the slash when STORE_FRONT_URL ends with one", () => {
      process.env.STORE_FRONT_URL = "https://store.example.com/";

      const url = AccessQrService.scanUrl("tenant-1", "abc123");

      expect(url).to.equal(
        "https://store.example.com/mobile-key/tenant-1/abc123",
      );
    });

    it("throws when STORE_FRONT_URL is not configured", () => {
      delete process.env.STORE_FRONT_URL;

      expect(() => AccessQrService.scanUrl("tenant-1", "abc123")).to.throw(
        /STORE_FRONT_URL/,
      );
    });

    it("carries the access point's current scan code, not its id", () => {
      const accessPoint = createAccessPoint();

      const url = AccessQrService.scanUrl(
        accessPoint.tenantId,
        accessPoint.scanCode,
      );

      expect(url).to.equal(
        `https://store.example.com/mobile-key/tenant-1/${accessPoint.scanCode}`,
      );
      expect(url).to.not.include(accessPoint.id);
    });
  });

  describe("render", () => {
    it("renders an svg by default", async () => {
      const accessPoint = createAccessPoint();

      const result = await AccessQrService.render(accessPoint);

      expect(result.format).to.equal("svg");
      expect(result.contentType).to.equal("image/svg+xml");
      expect(result.body).to.be.a("string");
      expect(result.body).to.include("<svg");
    });

    it("renders a png buffer", async () => {
      const accessPoint = createAccessPoint();

      const result = await AccessQrService.render(accessPoint, "png");

      expect(result.format).to.equal("png");
      expect(result.contentType).to.equal("image/png");
      expect(Buffer.isBuffer(result.body)).to.be.true;
      // PNG magic number
      expect(result.body.slice(1, 4).toString()).to.equal("PNG");
    });

    it("renders a pdf via the pdf-service with label, qr and instructions", async () => {
      const accessPoint = createAccessPoint({ label: "Nebeneingang" });

      const result = await AccessQrService.render(accessPoint, "pdf");

      expect(result.format).to.equal("pdf");
      expect(result.contentType).to.equal("application/pdf");
      expect(Buffer.isBuffer(result.body)).to.be.true;

      expect(PdfService.convertToPdf.calledOnce).to.be.true;
      const html = PdfService.convertToPdf.firstCall.args[0];
      expect(html).to.include("Nebeneingang");
      expect(html).to.include("Zum Öffnen scannen");
      expect(html).to.include("data:image/png;base64,");
    });

    it("escapes the label in the pdf template", async () => {
      const accessPoint = createAccessPoint({
        label: "<script>alert(1)</script>",
      });

      await AccessQrService.render(accessPoint, "pdf");

      const html = PdfService.convertToPdf.firstCall.args[0];
      expect(html).to.not.include("<script>alert(1)</script>");
      expect(html).to.include("&lt;script&gt;");
    });

    it("rejects an unknown format", async () => {
      const accessPoint = createAccessPoint();

      let error;
      try {
        await AccessQrService.render(accessPoint, "bmp");
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
    });
  });

  describe("QR_FORMATS", () => {
    it("exposes the supported formats", () => {
      expect(AccessQrService.QR_FORMATS).to.deep.equal({
        SVG: "svg",
        PNG: "png",
        PDF: "pdf",
      });
    });
  });
});
