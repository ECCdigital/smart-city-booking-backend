const TENANT_ID = "praktikum-kielregion";

const INDUSTRY_COLORS = {
  "Bau, Architektur, Vermessung": "#1f4f86",
  Dienstleistung: "#0e7fa8",
  Elektro: "#34a0ad",
  Gesundheit: "#16608a",
  Handwerk: "#5f8f1a",
  "IT, Computer": "#003064",
  "Kunst, Kultur, Gestaltung": "#4a78ad",
  "Landwirtschaft, Natur, Umwelt": "#95c121",
  Medien: "#0a7d8a",
  "Metall, Maschinenbau": "#51616d",
  Naturwissenschaften: "#21b5ea",
  "Produktion, Fertigung": "#2f7d6b",
  "Soziales, Pädagogik": "#6cc8ee",
  "Technik, Technologiefelder": "#005461",
  "Verkehr, Logistik": "#7aa520",
  "Wirtschaft, Handel, Verwaltung": "#b3d35a",
};

// Company-set application statuses (their brand colours drive the badges).
const STATUS_COLORS = {
  Neu: "#21b5ea",
  "In Prüfung": "#d99a00",
  Eingeladen: "#0e7fa8",
  Angenommen: "#2e9e5b",
  Abgesagt: "#c83a3a",
};

const TERMS_BY_TYPE = {
  application_status: [
    "Neu",
    "In Prüfung",
    "Eingeladen",
    "Angenommen",
    "Abgesagt",
  ],
  industry: Object.keys(INDUSTRY_COLORS),
  internship_type: [
    "Schulpraktikum",
    "Werkstudent",
    "Freiwilliges Praktikum",
    "Praktikum für Quereinsteiger",
  ],
  company_size: [
    "1–9 Personen",
    "10–49 Personen",
    "50–249 Personen",
    "über 250 Personen",
  ],
  district: ["Kiel", "Neumünster", "Rendsburg-Eckernförde", "Plön", "andere"],
  deletion_reason_company: [
    "Kein Bedarf an Praktikant*innen mehr",
    "Unternehmen geschlossen oder inaktiv",
    "Wechsel zu einem anderen Portal",
    "Datenschutzbedenken",
  ],
  deletion_reason_student: [
    "Praktikumsplatz gefunden",
    "Kein Interesse mehr",
    "Doppeltes Konto",
    "Datenschutzbedenken",
  ],
};

function slug(value) {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = {
  name: "26-06-2026-seed-taxonomy-terms",

  up: async function () {
    const TaxonomyTerm = require("../../src/commons/data-managers/models/taxonomyTermModel");

    for (const [type, names] of Object.entries(TERMS_BY_TYPE)) {
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const id = `${type}-${slug(name)}`;
        await TaxonomyTerm.updateOne(
          { id, tenantId: TENANT_ID },
          {
            $setOnInsert: {
              id,
              tenantId: TENANT_ID,
              type,
              name,
              color: INDUSTRY_COLORS[name] || STATUS_COLORS[name] || "",
              active: true,
              sortOrder: i,
            },
          },
          { upsert: true },
        );
      }
    }
  },

  down: async function () {
    const TaxonomyTerm = require("../../src/commons/data-managers/models/taxonomyTermModel");
    await TaxonomyTerm.deleteMany({ tenantId: TENANT_ID });
  },
};
