const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "file-url.js",
  level: process.env.LOG_LEVEL,
});

// delete the file named in a stored /files/get URL (best-effort)
async function deleteFileByUrl(tenantId, url) {
  if (!url) {
    return;
  }
  let path = null;
  try {
    path = new URL(url).searchParams.get("name");
  } catch {
    return;
  }
  if (!path) {
    return;
  }
  const { NextcloudManager } = require("../data-managers/file-manager");
  try {
    await NextcloudManager.deleteFile(tenantId, path);
  } catch (e) {
    logger.warn(`Could not delete file ${path}: ${e.message}`);
  }
}

module.exports = { deleteFileByUrl };
