const { asyncRouter } = require("../../../../middleware/async-router");
const {
  requireAuth,
  optionalAuth,
} = require("../../../../middleware/auth-middleware");
const MediaControllerV2 = require("../controllers/media.controller");

const router = asyncRouter();

router.post("/", requireAuth, MediaControllerV2.createMedia);
router.get("/", optionalAuth, MediaControllerV2.getMediaList);
router.get("/:id", optionalAuth, MediaControllerV2.getMedia);
router.patch("/:id", requireAuth, MediaControllerV2.updateMedia);
router.delete("/:id", requireAuth, MediaControllerV2.deleteMedia);
router.get("/:id/file", optionalAuth, MediaControllerV2.getMediaFile);

module.exports = router;
