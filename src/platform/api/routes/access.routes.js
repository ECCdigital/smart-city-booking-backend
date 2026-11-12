const express = require("express");
const router = express.Router({ mergeParams: true });
const { authorize } = require("../../../commons/services/authorization");
const AccessController = require("../controllers/access-controller");
const AccessAuditController = require("../controllers/access-audit-controller");

router.get(
  "/audit/export",
  authorize("accessAudit", "export"),
  AccessAuditController.exportAudit,
);

// Ahead of the `/:accessPointId/...` routes so a scan code can never be read
// as an access point id.
router.get(
  "/resolve-scan/:scanCode",
  authorize("accessScan", "resolve"),
  AccessController.resolveScan,
);

// Operating a door is the booking's right: the reach `any` is what waives the
// booking ownership at the access decision (glossary "Berechtigung").
router.post(
  "/:accessPointId/open",
  authorize("booking", "operate"),
  AccessController.open,
);

router.post(
  "/:accessPointId/close",
  authorize("booking", "operate"),
  AccessController.close,
);

router.get(
  "/:accessPointId/open-status",
  authorize("booking", "operate"),
  AccessController.getOpenStatus,
);

router.get(
  "/:accessPointId/status",
  authorize("booking", "operate"),
  AccessController.getStatus,
);

// Umsetzen (tickets#1044): moving a booking's zugeteiltes Fach to another
// free Fach of its Schließfachanlage is a change of the booking, so the
// right is the one that changes it.
router.get(
  "/:accessPointId/free-compartments",
  authorize("booking", "update"),
  AccessController.getFreeCompartments,
);

router.post(
  "/:accessPointId/reassign",
  authorize("booking", "update"),
  AccessController.reassign,
);

router.get(
  "/",
  authorize("booking", "operate"),
  AccessController.getAccessPoints,
);

module.exports = router;
