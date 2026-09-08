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
// booking ownership at the access decision (authorize spec §5).
router.post(
  "/:accessPointId/open",
  authorize("booking", "operate"),
  AccessController.open,
);

router.post(
  "/:accessPointId/unlatch",
  authorize("booking", "operate"),
  AccessController.unlatch,
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

router.get(
  "/",
  authorize("booking", "operate"),
  AccessController.getAccessPoints,
);

module.exports = router;
