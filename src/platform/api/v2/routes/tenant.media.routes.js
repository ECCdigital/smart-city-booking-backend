const { asyncRouter } = require("../../../../middleware/async-router");
const {
  authorize,
  publicRoute,
} = require("../../../../commons/services/authorization");
const MediaControllerV2 = require("../controllers/media.controller");

const router = asyncRouter();

router.post("/", authorize("media", "create"), MediaControllerV2.createMedia);
// Listing is the media library itself: it needs the picker right, and the
// reach narrows it to the caller's own uploads. The metadata routes serve two
// populations - the library and the booking documents - so they carry the
// door both come through (`media.metadata`) and name both questions on the
// marker; the media rights pick the one the medium follows.
const READ = { also: ["read", "bookingDocument"] };
router.get("/", authorize("media", "read"), MediaControllerV2.getMediaList);
router.get(
  "/:id",
  authorize("media", "metadata", READ),
  MediaControllerV2.getMedia,
);
router.patch(
  "/:id",
  authorize("media", "metadata", {
    also: ["update", "updateBookingDocument"],
  }),
  MediaControllerV2.updateMedia,
);
router.delete(
  "/:id",
  authorize("media", "delete"),
  MediaControllerV2.deleteMedia,
);
// Only the binary route follows the visibility of a medium: an internal file
// is a member's (`intern`), a booking document the receipt rule's.
router.get(
  "/:id/file",
  publicRoute("media", "file", { also: ["bookingDocument", "intern"] }),
  MediaControllerV2.getMediaFile,
);
router.get(
  "/:id/usage",
  authorize("media", "metadata", READ),
  MediaControllerV2.getMediaUsage,
);

module.exports = router;
