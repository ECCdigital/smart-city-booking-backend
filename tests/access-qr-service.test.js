const mock = require("mock-require");
const { expect } = require("chai");
const sinon = require("sinon");
const QRCode = require("qrcode");
const cheerio = require("cheerio");

const { AccessPoint } = require("../src/commons/entities/access/access-point");
const { BaseError } = require("../src/errors/BaseError");

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

    it("answers 503 store_front_url_missing when STORE_FRONT_URL is not configured", () => {
      delete process.env.STORE_FRONT_URL;

      let error;
      try {
        AccessQrService.scanUrl("tenant-1", "abc123");
      } catch (err) {
        error = err;
      }

      expect(error).to.be.instanceOf(BaseError);
      expect(error.statusCode).to.equal(503);
      expect(error.code).to.equal("store_front_url_missing");
    });

    it("counts a STORE_FRONT_URL of slashes alone as not configured", () => {
      process.env.STORE_FRONT_URL = "/";

      expect(() => AccessQrService.scanUrl("tenant-1", "abc123"))
        .to.throw(BaseError)
        .with.property("code", "store_front_url_missing");
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

  // tickets#1056: the QR code of one Fach of an Open Locker Anlage.
  describe("renderCompartment", () => {
    function anlage(overrides = {}) {
      return createAccessPoint({
        id: "anlage-1",
        provider: "open-locker",
        type: "locker",
        externalId: null,
        label: "Fahrradgarage Süd",
        config: { compartments: [fach()] },
        ...overrides,
      });
    }

    function fach(overrides = {}) {
      return {
        id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
        number: 3,
        lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
        outOfService: false,
        scanCode: "fach-code-3",
        previousScanCodes: ["fach-code-old"],
        ...overrides,
      };
    }

    const FACH_URL =
      "https://store.example.com/mobile-key/tenant-1/fach-code-3";

    it("encodes the scan URL with the code of the Fach, not the Anlage's", async () => {
      const result = await AccessQrService.renderCompartment(anlage(), fach());

      expect(result.format).to.equal("svg");
      expect(result.contentType).to.equal("image/svg+xml");
      expect(result.body).to.equal(
        await QRCode.toString(FACH_URL, { type: "svg" }),
      );
    });

    it("renders the door's A4 page with the Anlage and „Schrank X · Fach N“ above the code", async () => {
      const result = await AccessQrService.renderCompartment(
        anlage(),
        fach(),
        "pdf",
      );

      expect(result.contentType).to.equal("application/pdf");
      expect(Buffer.isBuffer(result.body)).to.be.true;
      expect(PdfService.convertToPdf.calledOnce).to.be.true;
      const html = PdfService.convertToPdf.firstCall.args[0];
      expect(html).to.include("Fahrradgarage Süd");
      expect(html).to.include("Schrank Labor Fachbank 1 · Fach 3");
      expect(html).to.include("Zum Öffnen scannen");
      // The template escapes the base64 padding (`=`), so it is left out.
      const fachQr = await QRCode.toDataURL(FACH_URL, {
        margin: 1,
        width: 320,
      });
      expect(html).to.include(fachQr.replace(/=+$/, ""));
      expect(html.indexOf("Schrank Labor Fachbank 1 · Fach 3")).to.be.below(
        html.indexOf("data:image/png;base64,"),
      );
    });

    it("leaves the door's page without a Fach line", async () => {
      await AccessQrService.render(createAccessPoint(), "pdf");

      const html = PdfService.convertToPdf.firstCall.args[0];
      expect(html).to.not.include("Schrank");
      expect(html).to.not.include('class="subtitle"');
    });

    it("names the file qr-<anlage>-schrank-<x>-fach-<nn>.<format>", async () => {
      const names = [];
      for (const format of ["svg", "png", "pdf"]) {
        const result = await AccessQrService.renderCompartment(
          anlage(),
          fach(),
          format,
        );
        names.push(result.filename);
      }

      expect(names).to.deep.equal([
        "qr-fahrradgarage-sued-schrank-labor-fachbank-1-fach-03.svg",
        "qr-fahrradgarage-sued-schrank-labor-fachbank-1-fach-03.png",
        "qr-fahrradgarage-sued-schrank-labor-fachbank-1-fach-03.pdf",
      ]);
      expect(PdfService.convertToPdf.firstCall.args[1]).to.equal(
        "qr-fahrradgarage-sued-schrank-labor-fachbank-1-fach-03.pdf",
      );
    });

    it("keeps the file name ASCII whatever the labels hold", async () => {
      const result = await AccessQrService.renderCompartment(
        anlage({ label: "  Größe Straße / Ü-Halle  " }),
        fach({ number: 12, lockerBank: { id: "b", name: 'Öst "A"' } }),
      );

      expect(result.filename).to.equal(
        "qr-groesse-strasse-ue-halle-schrank-oest-a-fach-12.svg",
      );
    });

    it("rejects an unknown format", async () => {
      let error;
      try {
        await AccessQrService.renderCompartment(anlage(), fach(), "bmp");
      } catch (err) {
        error = err;
      }

      expect(error).to.be.an("error");
    });

    it("escapes the Schrank in the pdf template", async () => {
      await AccessQrService.renderCompartment(
        anlage(),
        fach({ lockerBank: { id: "bank-1", name: "<b>Hof</b>" } }),
        "pdf",
      );

      const html = PdfService.convertToPdf.firstCall.args[0];
      expect(html).to.not.include("<b>Hof</b>");
      expect(html).to.include("&lt;b&gt;Hof&lt;/b&gt;");
    });
  });

  describe("renderCompartmentSheet", () => {
    function fach(id, number, lockerBank, overrides = {}) {
      return {
        id,
        number,
        lockerBank,
        outOfService: false,
        scanCode: `code-${id}`,
        previousScanCodes: [],
        ...overrides,
      };
    }

    const BANK_1 = { id: "bank-1", name: "Labor Fachbank 1" };

    /** The pages of the rendered sheet, each the labels on it. */
    function sheet() {
      const $ = cheerio.load(PdfService.convertToPdf.firstCall.args[0]);
      const text = (el, selector) => $(el).find(selector).text().trim();
      return $(".page")
        .toArray()
        .map((page) =>
          $(page)
            .find(".qr-label")
            .toArray()
            .map((el) => ({
              anlage: text(el, ".anlage"),
              bank: text(el, ".bank"),
              nrlabel: text(el, ".nrlabel"),
              nr: text(el, ".nr"),
              off: text(el, ".off"),
              instruction: text(el, ".instr"),
              qr: $(el).find(".qr").html().trim(),
            })),
        );
    }

    /** An svg as cheerio writes it back, to compare it with a label's. */
    function svgMarkup(svg) {
      return cheerio.load(svg, null, false).html().trim();
    }

    function labels(pages) {
      return pages.flat();
    }

    function anlage(compartments, overrides = {}) {
      return createAccessPoint({
        id: "anlage-1",
        provider: "open-locker",
        type: "locker",
        externalId: null,
        label: "Fahrradgarage Süd",
        config: { compartments },
        ...overrides,
      });
    }

    it("prints one borderless A4 pdf named qr-<anlage>-alle-faecher.pdf", async () => {
      const result = await AccessQrService.renderCompartmentSheet(
        anlage([fach("f1", 1, BANK_1)]),
      );

      expect(result.format).to.equal("pdf");
      expect(result.contentType).to.equal("application/pdf");
      expect(result.body.toString()).to.equal("pdf");
      expect(result.filename).to.equal(
        "qr-fahrradgarage-sued-alle-faecher.pdf",
      );
      expect(PdfService.convertToPdf.calledOnce).to.be.true;
      const [, filename, options] = PdfService.convertToPdf.firstCall.args;
      expect(filename).to.equal("qr-fahrradgarage-sued-alle-faecher.pdf");
      expect(options).to.deep.equal({ borderless: true });
    });

    it("labels each Fach with Anlage, „Schrank X“, its own QR code, „FACH“ with the number and the instruction", async () => {
      await AccessQrService.renderCompartmentSheet(
        anlage([fach("f1", 7, BANK_1)]),
      );

      const [label] = labels(sheet());
      expect(label.anlage).to.equal("Fahrradgarage Süd");
      expect(label.bank).to.equal("Schrank Labor Fachbank 1");
      expect(label.nrlabel).to.equal("FACH");
      expect(label.nr).to.equal("7");
      expect(label.instruction).to.equal("Scannen, um Ihr Fach zu öffnen");
      expect(label.qr).to.equal(
        svgMarkup(
          await QRCode.toString(
            "https://store.example.com/mobile-key/tenant-1/code-f1",
            { type: "svg", margin: 1 },
          ),
        ),
      );
    });

    it("starts each Schrank on a new page, in the order of the Zuteilung", async () => {
      const hof = { id: "bank-b", name: "Hof" };
      const hofToo = { id: "bank-a", name: "Hof" };
      const eingang = { id: "bank-z", name: "Eingang" };
      await AccessQrService.renderCompartmentSheet(
        anlage([
          fach("h10", 10, hof),
          fach("h2", 2, hof),
          fach("e1", 1, eingang),
          fach("a1", 1, hofToo),
          fach("h9", "9", hof),
        ]),
      );

      const pages = sheet().map((page) =>
        page.map((label) => `${label.bank} ${label.nr}`),
      );
      expect(pages).to.deep.equal([
        ["Schrank Eingang 1"],
        ["Schrank Hof 1"],
        ["Schrank Hof 2", "Schrank Hof 9", "Schrank Hof 10"],
      ]);
    });

    it("goes on to a new page after eight labels of one Schrank", async () => {
      const compartments = Array.from({ length: 9 }, (_, i) =>
        fach(`f${i + 1}`, i + 1, BANK_1),
      );
      await AccessQrService.renderCompartmentSheet(anlage(compartments));

      expect(
        sheet().map((page) => page.map((label) => label.nr)),
      ).to.deep.equal([["1", "2", "3", "4", "5", "6", "7", "8"], ["9"]]);
    });

    it("prints a Fach out of service with the note „außer Betrieb“, since its code still holds", async () => {
      await AccessQrService.renderCompartmentSheet(
        anlage([
          fach("f1", 1, BANK_1),
          fach("f2", 2, BANK_1, { outOfService: true }),
        ]),
      );

      expect(
        labels(sheet()).map((label) => [label.nr, label.off]),
      ).to.deep.equal([
        ["1", ""],
        ["2", "außer Betrieb"],
      ]);
    });

    it("escapes Anlage, Schrank and Fach in the template", async () => {
      await AccessQrService.renderCompartmentSheet(
        anlage([fach("f1", "<i>1</i>", { id: "b", name: "<b>Hof</b>" })], {
          label: "<script>x</script>",
        }),
      );

      const html = PdfService.convertToPdf.firstCall.args[0];
      expect(html).to.not.include("<b>Hof</b>");
      expect(html).to.not.include("<i>1</i>");
      expect(html).to.not.include("<script>x</script>");
      expect(labels(sheet())[0]).to.include({
        anlage: "<script>x</script>",
        bank: "Schrank <b>Hof</b>",
        nr: "<i>1</i>",
      });
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
