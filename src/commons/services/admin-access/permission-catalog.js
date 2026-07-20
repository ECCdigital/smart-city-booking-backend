// Fixed permission catalog for admin roles (served at /admin/access/permissions).

const PERMISSION_CATALOG = [
  {
    section: "companies",
    label: "Unternehmen",
    permissions: [
      { key: "companies:view", label: "Ansehen" },
      {
        key: "companies:moderate",
        label: "Moderieren (verifizieren / sperren / zurücksetzen)",
      },
      { key: "companies:edit", label: "Bearbeiten" },
      { key: "companies:create", label: "Anlegen" },
      { key: "companies:delete", label: "Löschen" },
    ],
  },
  {
    section: "offers",
    label: "Praktika",
    permissions: [
      { key: "offers:view", label: "Ansehen" },
      {
        key: "offers:moderate",
        label: "Moderieren (freigeben / ablehnen / archivieren / reaktivieren)",
      },
      { key: "offers:edit", label: "Bearbeiten" },
      { key: "offers:create", label: "Anlegen" },
      { key: "offers:delete", label: "Löschen" },
      { key: "applications:view", label: "Bewerbungen einsehen" },
    ],
  },
  {
    section: "students",
    label: "Schüler*innen",
    permissions: [
      { key: "students:view", label: "Ansehen" },
      {
        key: "students:manage",
        label: "Verwalten (sperren / entsperren / löschen)",
      },
    ],
  },
  {
    section: "taxonomies",
    label: "Taxonomien",
    permissions: [
      { key: "taxonomies:view", label: "Ansehen" },
      { key: "taxonomies:manage", label: "Verwalten" },
    ],
  },
  {
    section: "posts",
    label: "Inhalte / CMS",
    permissions: [
      { key: "posts:view", label: "Ansehen" },
      { key: "posts:create", label: "Anlegen" },
      { key: "posts:edit", label: "Bearbeiten" },
      { key: "posts:delete", label: "Löschen" },
    ],
  },
  {
    section: "stats",
    label: "Statistik",
    permissions: [{ key: "stats:view", label: "Ansehen" }],
  },
  {
    section: "audit",
    label: "Audit-Log",
    permissions: [{ key: "audit:view", label: "Ansehen" }],
  },
  {
    section: "settings",
    label: "Einstellungen",
    permissions: [
      { key: "settings:view", label: "Ansehen" },
      { key: "settings:manage", label: "Verwalten" },
    ],
  },
  {
    section: "access",
    label: "Zugriff",
    permissions: [
      { key: "access:view", label: "Ansehen" },
      {
        key: "access:manage",
        label: "Verwalten (Admins anlegen, Rollen zuweisen)",
      },
    ],
  },
];

const ALL_PERMISSIONS = PERMISSION_CATALOG.flatMap((s) =>
  s.permissions.map((p) => p.key),
);

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

function isValidPermission(key) {
  return PERMISSION_SET.has(key);
}

module.exports = { PERMISSION_CATALOG, ALL_PERMISSIONS, isValidPermission };
