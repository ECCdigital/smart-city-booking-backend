const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const Handlebars = require("handlebars");
const PdfService = require("../../pdf-service/pdf-service");

/**
 * Renderable formats of an access point QR code. `svg` is the default: it
 * scales without loss and is the lightest to hand out.
 */
const QR_FORMATS = Object.freeze({
  SVG: "svg",
  PNG: "png",
  PDF: "pdf",
});

const INSTRUCTION_TEXT = "Zum Öffnen scannen";

const PDF_TEMPLATE_PATH = path.join(
  __dirname,
  "templates",
  "access-point-qr.temp.html",
);

let compiledPdfTemplate;

function loadPdfTemplate() {
  if (!compiledPdfTemplate) {
    const templateContent = fs.readFileSync(PDF_TEMPLATE_PATH, "utf-8");
    compiledPdfTemplate = Handlebars.compile(templateContent);
  }
  return compiledPdfTemplate;
}

/**
 * Turns an access point into the printable QR code that leads back to it. The
 * URL schema - store-front base, tenant and scan code - stays server knowledge:
 * clients receive the rendered code, never the code inside it.
 */
class AccessQrService {
  /**
   * Build the URL a scanned QR code resolves to. The store-front base comes
   * from the global `STORE_FRONT_URL` env (the Vue app's `FRONTEND_URL` points
   * elsewhere and is not usable here). The scan code - not the entity id -
   * identifies the access point, so a rotated code voids the old sticker.
   *
   * @param {string} tenantId The tenant the access point belongs to
   * @param {string} scanCode The current scan code of the access point
   * @returns {string} The encoded store-front URL
   */
  static scanUrl(tenantId, scanCode) {
    const base = (process.env.STORE_FRONT_URL || "").replace(/\/+$/, "");
    if (!base) {
      throw new Error(
        "STORE_FRONT_URL is not set - cannot build the access point scan URL",
      );
    }
    return `${base}/mobile-key/${tenantId}/${scanCode}`;
  }

  /**
   * Render the QR code of an access point in the requested format.
   *
   * @param {import("../../entities/access/access-point").AccessPoint} accessPoint
   *   The access point to render
   * @param {string} [format=svg] One of `svg`, `png`, `pdf`
   * @returns {Promise<{ format: string, contentType: string,
   *   body: string|Buffer, filename: string }>} The rendered QR code
   * @throws {Error} If the format is not supported
   */
  static async render(accessPoint, format = QR_FORMATS.SVG) {
    const url = this.scanUrl(accessPoint.tenantId, accessPoint.scanCode);

    switch (format) {
      case QR_FORMATS.SVG:
        return {
          format: QR_FORMATS.SVG,
          contentType: "image/svg+xml",
          body: await QRCode.toString(url, { type: "svg" }),
          filename: `access-point-${accessPoint.id}.svg`,
        };
      case QR_FORMATS.PNG:
        return {
          format: QR_FORMATS.PNG,
          contentType: "image/png",
          body: await QRCode.toBuffer(url),
          filename: `access-point-${accessPoint.id}.png`,
        };
      case QR_FORMATS.PDF:
        return {
          format: QR_FORMATS.PDF,
          contentType: "application/pdf",
          body: await this._renderPdf(accessPoint, url),
          filename: `access-point-${accessPoint.id}.pdf`,
        };
      default:
        throw new Error(`Unsupported QR code format: ${format}`);
    }
  }

  /**
   * @private
   * Render the A4 print template: the access point label, its QR code and a
   * short instruction, laid out through the shared Playwright pdf-service.
   */
  static async _renderPdf(accessPoint, url) {
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    const html = loadPdfTemplate()({
      label: accessPoint.label,
      qrDataUrl,
      instruction: INSTRUCTION_TEXT,
    });

    const { buffer } = await PdfService.convertToPdf(
      html,
      `access-point-${accessPoint.id}.pdf`,
    );
    return buffer;
  }
}

module.exports = AccessQrService;
module.exports.QR_FORMATS = QR_FORMATS;
