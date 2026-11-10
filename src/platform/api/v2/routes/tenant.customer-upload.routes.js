const { asyncRouter } = require("../../../../middleware/async-router");
const { authorize } = require("../../../../commons/services/authorization");
const {
  acceptSingleFile,
} = require("../../../../middleware/file-upload");
const {
  customerUploadLimits,
} = require("../../../../commons/services/customer-upload/customer-upload-rules");
const CustomerUploadControllerV2 = require("../controllers/customer-upload.controller");

const router = asyncRouter();

const MEGABYTE = 1024 * 1024;

// One megabyte above the instance limit of a customer upload: the service
// answers a larger file with its own reason, from the cut-off file.
const accept = () =>
  acceptSingleFile({
    backstopBytes: () => (customerUploadLimits().maxFileSizeMb + 1) * MEGABYTE,
    truncate: true,
  });

// Mounted at `/api/v2/:tenant/bookings/:id/customer-uploads`. The booking,
// the field and the rate limit are checked before the body is parsed.
router.post(
  "/:fieldId",
  authorize("booking", "customerUpload"),
  CustomerUploadControllerV2.admitUpload,
  accept(),
  CustomerUploadControllerV2.upload,
);
router.put(
  "/:fieldId/:mediaId",
  authorize("booking", "customerUpload"),
  CustomerUploadControllerV2.admitUpload,
  accept(),
  CustomerUploadControllerV2.replace,
);
// The check by the staff and „Erneut anfordern“:
// whoever may edit the booking; a JSON body, no file.
router.post(
  "/:fieldId/request-again",
  authorize("booking", "reviewCustomerUpload"),
  CustomerUploadControllerV2.requestAgain,
);
router.post(
  "/:fieldId/:mediaId/review",
  authorize("booking", "reviewCustomerUpload"),
  CustomerUploadControllerV2.review,
);
router.delete(
  "/:fieldId/:mediaId",
  authorize("booking", "customerUpload"),
  CustomerUploadControllerV2.admitRemoval,
  CustomerUploadControllerV2.remove,
);

module.exports = router;
