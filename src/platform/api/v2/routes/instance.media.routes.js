const { asyncRouter } = require("../../../../middleware/async-router");
const {
  authorize,
  publicRoute,
} = require("../../../../commons/services/authorization");
const MediaControllerV2 = require("../controllers/media.controller");

const router = asyncRouter();

// The instance library is the same media library, addressed without a tenant
// (§4.9) — the handlers are the tenant ones, the missing `:tenant` puts them
// in the instance scope. The rights table tells the two apart by the resource
// (`instanceMedia` against `media`, authorize spec §3.2): everything but
// reading a file is the instance owner's; `public` media are readable
// anonymously, `intern` ones by any signed-in user.
router.post(
  "/",
  authorize("instanceMedia", "create"),
  MediaControllerV2.createMedia,
);
router.get(
  "/",
  authorize("instanceMedia", "read"),
  MediaControllerV2.getMediaList,
);
router.get(
  "/:id",
  authorize("instanceMedia", "read"),
  MediaControllerV2.getMedia,
);
router.patch(
  "/:id",
  authorize("instanceMedia", "update"),
  MediaControllerV2.updateMedia,
);
router.delete(
  "/:id",
  authorize("instanceMedia", "delete"),
  MediaControllerV2.deleteMedia,
);
router.get(
  "/:id/file",
  publicRoute("instanceMedia", "file"),
  MediaControllerV2.getMediaFile,
);
router.get(
  "/:id/usage",
  authorize("instanceMedia", "read"),
  MediaControllerV2.getMediaUsage,
);

module.exports = router;
