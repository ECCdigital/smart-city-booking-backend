const express = require("express");
const router = express.Router({ mergeParams: true });
const AuthenticationController = require("../../authentication/controllers/authentication-controller");
const AccessController = require("../controllers/access-controller");
const AccessAuditController = require("../controllers/access-audit-controller");

router.get(
  "/audit/export",
  AuthenticationController.isSignedIn,
  AccessAuditController.exportAudit,
);

// Ahead of the `/:accessPointId/...` routes so a scan code can never be read
// as an access point id.
router.get(
  "/resolve-scan/:scanCode",
  AuthenticationController.isSignedIn,
  AccessController.resolveScan,
);

router.post(
  "/:accessPointId/open",
  AuthenticationController.isSignedIn,
  AccessController.open,
);

router.post(
  "/:accessPointId/unlatch",
  AuthenticationController.isSignedIn,
  AccessController.unlatch,
);

router.post(
  "/:accessPointId/close",
  AuthenticationController.isSignedIn,
  AccessController.close,
);

router.get(
  "/:accessPointId/open-status",
  AuthenticationController.isSignedIn,
  AccessController.getOpenStatus,
);

router.get(
  "/:accessPointId/status",
  AuthenticationController.isSignedIn,
  AccessController.getStatus,
);

router.get(
  "/",
  AuthenticationController.isSignedIn,
  AccessController.getAccessPoints,
);

module.exports = router;
