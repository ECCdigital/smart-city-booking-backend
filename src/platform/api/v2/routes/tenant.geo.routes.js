const { asyncRouter } = require("../../../../middleware/async-router");
const { authorize } = require("../../../../commons/services/authorization");
const GeoControllerV2 = require("../controllers/geo.controller");

const router = asyncRouter();

router.get("/search", authorize("geo", "search"), GeoControllerV2.search);
router.get("/reverse", authorize("geo", "reverse"), GeoControllerV2.reverse);

module.exports = router;
