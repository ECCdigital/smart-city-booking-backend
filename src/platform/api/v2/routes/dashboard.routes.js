const { asyncRouter } = require("../../../../middleware/async-router");
const { authorize } = require("../../../../commons/services/authorization");
const DashboardControllerV2 = require("../controllers/dashboard.controller");

const router = asyncRouter();

router.get(
  "/summary",
  authorize("instanceDashboard", "read"),
  DashboardControllerV2.getInstanceSummary,
);

module.exports = router;
