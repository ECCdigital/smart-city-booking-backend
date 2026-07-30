const { asyncRouter } = require("../../../../middleware/async-router");
const AuthenticationController = require("../../../authentication/controllers/authentication-controller");
const DashboardControllerV2 = require("../controllers/dashboard.controller");

const router = asyncRouter();

router.get(
  "/summary",
  AuthenticationController.isSignedIn,
  DashboardControllerV2.getTenantSummary,
);

module.exports = router;
