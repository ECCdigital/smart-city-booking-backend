const { asyncRouter } = require("../../../../middleware/async-router");
const {
  requireAuth,
  optionalAuth,
} = require("../../../../middleware/auth-middleware");
const MediaControllerV2 = require("../controllers/media.controller");

const router = asyncRouter();

// The instance library is the same media library, addressed without a tenant
// (§4.9) — the handlers are the tenant ones, the missing `:tenant` puts them
// in the instance scope. Everything but reading a file is the instance
// owner's; `public` media are readable anonymously, `intern` ones by any
// signed-in user.
router.post("/", requireAuth, MediaControllerV2.createMedia);
router.get("/", requireAuth, MediaControllerV2.getMediaList);
router.get("/:id", requireAuth, MediaControllerV2.getMedia);
router.patch("/:id", requireAuth, MediaControllerV2.updateMedia);
router.delete("/:id", requireAuth, MediaControllerV2.deleteMedia);
router.get("/:id/file", optionalAuth, MediaControllerV2.getMediaFile);
router.get("/:id/usage", requireAuth, MediaControllerV2.getMediaUsage);

module.exports = router;
