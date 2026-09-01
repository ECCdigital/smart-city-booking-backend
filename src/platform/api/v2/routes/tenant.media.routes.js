const { asyncRouter } = require("../../../../middleware/async-router");
const {
  requireAuth,
  optionalAuth,
} = require("../../../../middleware/auth-middleware");
const MediaControllerV2 = require("../controllers/media.controller");

const router = asyncRouter();

router.post("/", requireAuth, MediaControllerV2.createMedia);
// Listing and metadata are the media library itself: they need the picker
// right. Only the binary route follows the visibility of a medium.
router.get("/", requireAuth, MediaControllerV2.getMediaList);
router.get("/:id", requireAuth, MediaControllerV2.getMedia);
router.patch("/:id", requireAuth, MediaControllerV2.updateMedia);
router.delete("/:id", requireAuth, MediaControllerV2.deleteMedia);
router.get("/:id/file", optionalAuth, MediaControllerV2.getMediaFile);
router.get("/:id/usage", requireAuth, MediaControllerV2.getMediaUsage);

module.exports = router;
