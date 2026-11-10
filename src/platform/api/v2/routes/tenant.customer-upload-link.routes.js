const { asyncRouter } = require("../../../../middleware/async-router");
const { publicRoute } = require("../../../../commons/services/authorization");
const {
  acceptSingleFile,
  acceptSubmissionFiles,
} = require("../../../../middleware/file-upload");
const {
  customerUploadLimits,
} = require("../../../../commons/services/customer-upload/customer-upload-rules");
const CustomerUploadControllerV2 = require("../controllers/customer-upload.controller");

const MEGABYTE = 1024 * 1024;

// As for the booking person: one megabyte above the instance limit.
const accept = () =>
  acceptSingleFile({
    backstopBytes: () => (customerUploadLimits().maxFileSizeMb + 1) * MEGABYTE,
    truncate: true,
  });

// A guest hands proofs in with the signed link of the booking,
// the token in the header
// `X-Customer-Upload-Link` in place of a sign-in. Mounted at
// `/api/v2/:tenant/bookings/:id/customer-uploads-by-link`.
const byLink = asyncRouter();
byLink.get(
  "/",
  publicRoute("booking", "customerUploadByLink"),
  CustomerUploadControllerV2.readByLink,
);
byLink.post(
  "/",
  publicRoute("booking", "customerUploadByLink"),
  CustomerUploadControllerV2.admitSubmissionByLink,
  acceptSubmissionFiles(),
  CustomerUploadControllerV2.submit,
);
byLink.post(
  "/:fieldId",
  publicRoute("booking", "customerUploadByLink"),
  CustomerUploadControllerV2.admitUploadByLink,
  accept(),
  CustomerUploadControllerV2.upload,
);
byLink.put(
  "/:fieldId/:mediaId",
  publicRoute("booking", "customerUploadByLink"),
  CustomerUploadControllerV2.admitUploadByLink,
  accept(),
  CustomerUploadControllerV2.replace,
);
byLink.delete(
  "/:fieldId/:mediaId",
  publicRoute("booking", "customerUploadByLink"),
  CustomerUploadControllerV2.admitRemovalByLink,
  CustomerUploadControllerV2.remove,
);

module.exports = byLink;
