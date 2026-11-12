const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const Handlebars = require("handlebars");
const PdfService = require("../../pdf-service/pdf-service");
const { BaseError } = require("../../../errors/BaseError");
const { compartmentsOf } = require("./locker-system-compartments");
const { inAllocationOrder } = require("./compartment-allocation");

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

const SHEET_INSTRUCTION_TEXT = "Scannen, um Ihr Fach zu öffnen";

/** Labels on one Etikettenbogen: 2×4 of 105 × 74 mm (A7) on A4. */
const LABELS_PER_SHEET = 8;

const SHEET_TEMPLATE_PATH = path.join(
  __dirname,
  "templates",
  "access-point-qr-sheet.temp.html",
);

let compiledPdfTemplate;
let compiledSheetTemplate;

/**
 * Turn a label into the ASCII part of a file name: lower case, umlauts
 * spelled out, every other run of non-alphanumerics one dash.
 */
function slug(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadPdfTemplate() {
  if (!compiledPdfTemplate) {
    const templateContent = fs.readFileSync(PDF_TEMPLATE_PATH, "utf-8");
    compiledPdfTemplate = Handlebars.compile(templateContent);
  }
  return compiledPdfTemplate;
}

/**
 * Lay labels in Zuteilung order out on sheets: every Schrank starts a new
 * one, so the sheets can be handed out per Schrank.
 */
function sheetPages(labels) {
  const pages = [];
  let previous;
  for (const label of labels) {
    const current = pages[pages.length - 1];
    const sameBank =
      previous &&
      previous.lockerBankId === label.lockerBankId &&
      previous.lockerBankName === label.lockerBankName;
    if (!sameBank || current.labels.length === LABELS_PER_SHEET) {
      pages.push({ labels: [label] });
    } else {
      current.labels.push(label);
    }
    previous = label;
  }
  return pages;
}

function loadSheetTemplate() {
  if (!compiledSheetTemplate) {
    const templateContent = fs.readFileSync(SHEET_TEMPLATE_PATH, "utf-8");
    compiledSheetTemplate = Handlebars.compile(templateContent);
  }
  return compiledSheetTemplate;
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
   * Without `STORE_FRONT_URL` there is no address to encode. That is the
   * instance's configuration, not a failure of the request, so it is answered
   * as such (`503 store_front_url_missing`) for the administration to name,
   * instead of a bare 500.
   *
   * @param {string} tenantId The tenant the access point belongs to
   * @param {string} scanCode The current scan code of the access point
   * @returns {string} The encoded store-front URL
   * @throws {BaseError} `store_front_url_missing` (503) when the env is not set
   */
  static scanUrl(tenantId, scanCode) {
    const base = (process.env.STORE_FRONT_URL || "").replace(/\/+$/, "");
    if (!base) {
      throw new BaseError("store_front_url_missing", 503);
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
    return this._render(
      this.scanUrl(accessPoint.tenantId, accessPoint.scanCode),
      format,
      { label: accessPoint.label },
      `access-point-${accessPoint.id}`,
    );
  }

  /**
   * Render the QR code of one Fach of a Schließfachanlage that carries its
   * own list (tickets#1056). The code is the Fach's own scan code, never the
   * Anlage's; the A4 page is the door's, with „Schrank X · Fach N“ under the
   * Anlage's label. The file is named after Anlage, Schrank and Fach:
   * `qr-<anlage>-schrank-<x>-fach-<nn>.<format>`.
   *
   * @param {import("../../entities/access/access-point").AccessPoint} anlage
   *   The Schließfachanlage the Fach belongs to
   * @param {Object} compartment Its entry in `config.compartments`
   * @param {string} [format=svg] One of `svg`, `png`, `pdf`
   * @returns {Promise<{ format: string, contentType: string,
   *   body: string|Buffer, filename: string }>} The rendered QR code
   * @throws {Error} If the format is not supported
   */
  static async renderCompartment(anlage, compartment, format = QR_FORMATS.SVG) {
    const lockerBankName = compartment.lockerBank?.name ?? "";
    return this._render(
      this.scanUrl(anlage.tenantId, compartment.scanCode),
      format,
      {
        label: anlage.label,
        subtitle: `Schrank ${lockerBankName} · Fach ${compartment.number}`,
      },
      [
        "qr",
        slug(anlage.label),
        "schrank",
        slug(lockerBankName),
        "fach",
        slug(compartment.number).padStart(2, "0"),
      ].join("-"),
    );
  }

  /**
   * Render the Sammel-PDF of a Schließfachanlage that carries its own list
   * (tickets#1062): the codes of all its Fächer on an Etikettenbogen.
   *
   * @param {import("../../entities/access/access-point").AccessPoint} anlage
   *   The Schließfachanlage, with its Fächer in `config.compartments`
   * @returns {Promise<{ format: string, contentType: string,
   *   body: Buffer, filename: string }>} The rendered PDF
   */
  static async renderCompartmentSheet(anlage) {
    const filename = `qr-${slug(anlage.label)}-alle-faecher.pdf`;
    const labels = await Promise.all(
      inAllocationOrder(compartmentsOf(anlage)).map(async (compartment) => ({
        lockerBankId: compartment.lockerBank?.id ?? null,
        lockerBankName: compartment.lockerBank?.name ?? "",
        number: compartment.number,
        outOfService: compartment.outOfService === true,
        qrSvg: await QRCode.toString(
          this.scanUrl(anlage.tenantId, compartment.scanCode),
          { type: "svg", margin: 1 },
        ),
      })),
    );
    const html = loadSheetTemplate()({
      label: anlage.label,
      instruction: SHEET_INSTRUCTION_TEXT,
      pages: sheetPages(labels),
    });

    const { buffer } = await PdfService.convertToPdf(html, filename, {
      borderless: true,
    });
    return {
      format: QR_FORMATS.PDF,
      contentType: "application/pdf",
      body: buffer,
      filename,
    };
  }

  /**
   * @private
   * Render `url` as a QR code in `format`; the PDF lays out `page` (label and
   * optional subtitle) on the A4 print template.
   */
  static async _render(url, format, page, basename) {
    switch (format) {
      case QR_FORMATS.SVG:
        return {
          format: QR_FORMATS.SVG,
          contentType: "image/svg+xml",
          body: await QRCode.toString(url, { type: "svg" }),
          filename: `${basename}.svg`,
        };
      case QR_FORMATS.PNG:
        return {
          format: QR_FORMATS.PNG,
          contentType: "image/png",
          body: await QRCode.toBuffer(url),
          filename: `${basename}.png`,
        };
      case QR_FORMATS.PDF:
        return {
          format: QR_FORMATS.PDF,
          contentType: "application/pdf",
          body: await this._renderPdf(page, url, `${basename}.pdf`),
          filename: `${basename}.pdf`,
        };
      default:
        throw new Error(`Unsupported QR code format: ${format}`);
    }
  }

  /**
   * @private
   * Render the A4 print template: the label, an optional subtitle, the QR
   * code and a short instruction, laid out through the shared Playwright
   * pdf-service.
   */
  static async _renderPdf({ label, subtitle }, url, filename) {
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    const html = loadPdfTemplate()({
      label,
      subtitle,
      qrDataUrl,
      instruction: INSTRUCTION_TEXT,
    });

    const { buffer } = await PdfService.convertToPdf(html, filename);
    return buffer;
  }
}

module.exports = AccessQrService;
module.exports.QR_FORMATS = QR_FORMATS;
