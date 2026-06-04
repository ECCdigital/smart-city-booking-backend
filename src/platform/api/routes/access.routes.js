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

router.post(
  "/:accessPointId/open",
  AuthenticationController.isSignedIn,
  AccessController.open,
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
