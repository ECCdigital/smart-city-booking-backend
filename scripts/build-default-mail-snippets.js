const fs = require("fs");
const path = require("path");

function buildSnippet(rowId, columns) {
  const mailBlocksColumns = columns.map((column) => ({
    width: column.width,
    blocks: column.blocks.map((block) => ({
      type: block.type,
      align: block.align,
      html: block.editorHtml,
      id: block.id,
    })),
  }));

  const blocks = [{ id: rowId, type: "row", columns: mailBlocksColumns }];
  const b64 = Buffer.from(JSON.stringify(blocks)).toString("base64");
  const htmlParts = columns.flatMap((column) =>
    column.blocks.map((block) => block.renderedHtml),
  );
  const renderedHtml = `<div style="font-family:-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; color:#222222; line-height:1.5; font-size:16px;">\n<div style=""><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse;"><tr><td style="vertical-align:top; width:100%;" width="100%">${htmlParts.join("\n")}</td></tr></table></div>\n</div>`;

  return `<!--MAILBLOCKS:v=1;b64=${b64}-->\n${renderedHtml}`;
}

function textBlock(id, editorHtml, renderedHtml) {
  return {
    id,
    type: "text",
    align: "left",
    editorHtml,
    renderedHtml,
  };
}

function tenantNameChip() {
  return '<span data-variable="tenantName" data-triple="false" data-label="Mandant" class="mail-variable-chip" contenteditable="false">{{tenantName}}</span>';
}

const DEFAULT_MAIL_SNIPPETS = {
  "booking-confirmation": buildSnippet("231034d1-3165-4c6e-acd7-1a630cebad09", [
    {
      width: 12,
      blocks: [
        textBlock(
          "e181762e-bc3d-4f68-8265-a57b01cc65a5",
          `<p>Hallo,<br />vielen Dank für Ihre Buchung im <strong>${tenantNameChip()}</strong>.</p>`,
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Hallo,<br>vielen Dank für Ihre Buchung im <strong><span data-variable="tenantName" class="mail-variable-chip">{{tenantName}}</span></strong>.</p></div>`,
        ),
        textBlock(
          "dfe5ea6e-d4ed-4996-85dc-2989feff5d53",
          "<p>Im Folgenden senden wir Ihnen die Details Ihrer Buchung.</p>",
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Im Folgenden senden wir Ihnen die Details Ihrer Buchung.</p></div>`,
        ),
      ],
    },
  ]),
  "free-booking-confirmation": buildSnippet(
    "719858b7-37c5-43ca-bfbf-3aea88701122",
    [
      {
        width: 12,
        blocks: [
          textBlock(
            "d4b2d09c-bcf0-487b-a985-77d8f5561a9a",
            `<p>Hallo,<br />vielen Dank für Ihre kostenfreie Buchung im <strong>${tenantNameChip()}</strong>.</p>`,
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Hallo,<br>vielen Dank für Ihre kostenfreie Buchung im <strong><span data-variable="tenantName" class="mail-variable-chip">{{tenantName}}</span></strong>.</p></div>`,
          ),
        ],
      },
    ],
  ),
  "booking-request-confirmation": buildSnippet(
    "044ed3f2-6613-429b-ab39-f7f69b6b8812",
    [
      {
        width: 12,
        blocks: [
          textBlock(
            "3671fec6-6b4e-471b-b6be-ce96c329cc47",
            `<p>Hallo,<br />vielen Dank für Ihre Buchungsanfrage im <strong>${tenantNameChip()}</strong>.</p>`,
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Hallo,<br>vielen Dank für Ihre Buchungsanfrage im <strong><span data-variable="tenantName" class="mail-variable-chip">{{tenantName}}</span></strong>.</p></div>`,
          ),
          textBlock(
            "65749e0b-6ad7-4fc0-b537-bd863f955dcc",
            "<p>Ihre Buchungsanfrage ist bei uns eingegangen und wird derzeit zur Freigabe geprüft.</p>",
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Ihre Buchungsanfrage ist bei uns eingegangen und wird derzeit zur Freigabe geprüft.</p></div>`,
          ),
          textBlock(
            "57f35367-c3ac-4cfb-bbe4-f50df83e5a47",
            "<p>Sobald Ihre Anfrage freigegeben wurde, erhalten Sie eine Benachrichtigung von uns.</p>",
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Sobald Ihre Anfrage freigegeben wurde, erhalten Sie eine Benachrichtigung von uns.</p></div>`,
          ),
        ],
      },
    ],
  ),
  "booking-confirmed-invoice-pending": buildSnippet(
    "8844e141-6191-4b8b-a3e3-05071b46e55e",
    [
      {
        width: 12,
        blocks: [
          textBlock(
            "ea6439a9-8bfc-487a-a75b-512c64884966",
            `<p>Hallo,<br />vielen Dank für Ihre Buchung bei <strong>${tenantNameChip()}</strong>.</p>`,
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Hallo,<br>vielen Dank für Ihre Buchung bei <strong><span data-variable="tenantName" class="mail-variable-chip">{{tenantName}}</span></strong>.</p></div>`,
          ),
          textBlock(
            "39f04820-3e32-4b14-a80b-a6b957694e42",
            "<p>Ihre Buchung wurde erfolgreich bestätigt. Eine Rechnung wird Ihnen separat zugestellt.</p>",
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Ihre Buchung wurde erfolgreich bestätigt. Eine Rechnung wird Ihnen separat zugestellt.</p></div>`,
          ),
        ],
      },
    ],
  ),
  "booking-cancel": buildSnippet("7479b809-3986-4120-a07e-8fa44c0dce69", [
    {
      width: 12,
      blocks: [
        textBlock(
          "2684c792-6405-428d-abe0-fd9ad5a145da",
          "<p>Die nachfolgende Buchung wurde storniert:</p>",
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Die nachfolgende Buchung wurde storniert:</p></div>`,
        ),
      ],
    },
  ]),
  "booking-rejection": buildSnippet("1e2c6310-a3fd-4ee5-8690-4d6701101428", [
    {
      width: 12,
      blocks: [
        textBlock(
          "9af725e4-f1e5-41e7-9bea-ddfe24a3fdfb",
          "<p>Die nachfolgende Buchung wurde abgelehnt:</p>",
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Die nachfolgende Buchung wurde abgelehnt:</p></div>`,
        ),
      ],
    },
  ]),
  invoice: buildSnippet("82dc446e-e302-4ee7-a3ed-87495e9365e3", [
    {
      width: 12,
      blocks: [
        textBlock(
          "37bf4b8a-9153-432f-bd25-2227aceb5982",
          `<p>Hallo,<br />vielen Dank für Ihre Buchung bei <strong>${tenantNameChip()}</strong>.</p>`,
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Hallo,<br>vielen Dank für Ihre Buchung bei <strong><span data-variable="tenantName" class="mail-variable-chip">{{tenantName}}</span></strong>.</p></div>`,
        ),
        textBlock(
          "f97a59ec-bfa9-465d-9f93-78b3a0f2e6f7",
          "<p>Bitte überweisen Sie zur Vervollständigung Ihrer Buchung den im Anhang aufgeführten Betrag auf das angegebene Konto.</p>",
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Bitte überweisen Sie zur Vervollständigung Ihrer Buchung den im Anhang aufgeführten Betrag auf das angegebene Konto.</p></div>`,
        ),
      ],
    },
  ]),
  "invoice-after-approval": buildSnippet("425ef5e7-3486-4c63-9ac7-b542bb181d3f", [
    {
      width: 12,
      blocks: [
        textBlock(
          "5fde5d1c-ebf6-4dfe-8784-45b61d0c7c0f",
          `<p>Vielen Dank für Ihre Buchungsanfrage im <strong>${tenantNameChip()}</strong>. Wir haben diese erfolgreich geprüft und freigegeben.</p>`,
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Vielen Dank für Ihre Buchungsanfrage im <strong><span data-variable="tenantName" class="mail-variable-chip">{{tenantName}}</span></strong>. Wir haben diese erfolgreich geprüft und freigegeben.</p></div>`,
        ),
        textBlock(
          "6e862c3d-208e-4d34-87ff-c7b9096a94bd",
          "<p>Bitte überweisen Sie zur Vervollständigung Ihrer Buchung den im Anhang aufgeführten Betrag auf das angegebene Konto.</p>",
          `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Bitte überweisen Sie zur Vervollständigung Ihrer Buchung den im Anhang aufgeführten Betrag auf das angegebene Konto.</p></div>`,
        ),
      ],
    },
  ]),
  "payment-link-after-approval": buildSnippet(
    "c3c41018-4342-40ae-8bce-31377e0ed4ba",
    [
      {
        width: 12,
        blocks: [
          textBlock(
            "b987392d-e848-486e-a747-ea53e66f0880",
            `<p>Vielen Dank für Ihre Buchungsanfrage im <strong>${tenantNameChip()}</strong>. Wir haben Ihre Anfrage geprüft und freigegeben.</p>`,
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Vielen Dank für Ihre Buchungsanfrage im <strong><span data-variable="tenantName" class="mail-variable-chip">{{tenantName}}</span></strong>. Wir haben Ihre Anfrage geprüft und freigegeben.</p></div>`,
          ),
          textBlock(
            "eb341263-0a49-4a9d-8eef-c2b70abfaa1e",
            "<p>Um Ihre Buchung verbindlich abzuschließen, klicken Sie bitte auf den nachfolgenden Knopf und folgen Sie den weiteren Schritten.</p>",
            `<div style="text-align:left; color:#222222; font-size:16px; line-height:1.5;"><p>Um Ihre Buchung verbindlich abzuschließen, klicken Sie bitte auf den nachfolgenden Knopf und folgen Sie den weiteren Schritten.</p></div>`,
          ),
        ],
      },
    ],
  ),
};

const targetPath = path.join(
  __dirname,
  "../src/commons/mail-service/templates/default-mail-snippets.json",
);
fs.writeFileSync(targetPath, JSON.stringify(DEFAULT_MAIL_SNIPPETS, null, 2));

console.log(`Wrote ${Object.keys(DEFAULT_MAIL_SNIPPETS).length} snippets to ${targetPath}`);
