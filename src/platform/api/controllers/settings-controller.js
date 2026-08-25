const bunyan = require("bunyan");
const CompanyController = require("./company-controller");
const PlatformSettingsService = require("../../../commons/services/platform-settings-service");
const platformSettingsSchema = require("../../../commons/schemas/platformSettingsSchema");
const {
  NextcloudManager,
} = require("../../../commons/data-managers/file-manager");
const { deleteFileByUrl } = require("../../../commons/utilities/file-url");
const { MAX_IMAGE_BYTES } = require("../../../commons/utilities/upload-limits");
const { sendError } = require("../../../commons/utilities/http-error");

const SETTINGS_KEYS = Object.keys(platformSettingsSchema);

const logger = bunyan.createLogger({
  name: "settings-controller.js",
  level: process.env.LOG_LEVEL,
});

class SettingsController {
  static async getSettings(request, response) {
    try {
      const tenantId = request.params.tenant;
      const settings = await PlatformSettingsService.getSettings(tenantId);
      const keyParam = request.query && request.query.key;
      if (keyParam !== undefined && keyParam !== "") {
        const requested = String(keyParam)
          .split(",")
          .map((key) => key.trim())
          .filter(Boolean);
        const unknown = requested.filter((key) => !SETTINGS_KEYS.includes(key));
        if (unknown.length > 0) {
          return response
            .status(400)
            .send(`Unknown settings key(s): ${unknown.join(", ")}`);
        }
        const projected = {};
        for (const key of requested) {
          projected[key] = settings[key];
        }
        return response.status(200).send(projected);
      }
      return response.status(200).send(settings);
    } catch (error) {
      logger.error("Could not load settings", error);
      return sendError(response, error, "Could not load settings");
    }
  }

  static async updateSettings(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const settings = await PlatformSettingsService.updateSettings(
        tenantId,
        request.body || {},
      );
      return response.status(200).send(settings);
    } catch (error) {
      logger.error("Could not update settings", error);
      return sendError(response, error, "Could not update settings");
    }
  }

  static async uploadLogo(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const file = request.files && request.files.file;
      if (
        !file ||
        !file.name ||
        file.name.includes("..") ||
        file.name.includes("/")
      ) {
        return response.status(400).send("Invalid or missing file.");
      }
      if (!file.mimetype || !file.mimetype.startsWith("image/")) {
        return response.status(400).send("Logo must be an image.");
      }
      if (file.data.length > MAX_IMAGE_BYTES) {
        return response.status(413).send("Logo file is too large (max 8 MB).");
      }
      const existing = await PlatformSettingsService.getSettings(tenantId);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `settings-logo-${safeName}`;
      await NextcloudManager.createFile({
        tenantID: tenantId,
        file: { name: fileName, data: file.data },
        subFolder: "public/logos",
      });
      const logoUrl = `${process.env.BACKEND_URL}/api/${tenantId}/files/get?name=/public/logos/${encodeURIComponent(fileName)}`;
      const settings = await PlatformSettingsService.updateSettings(tenantId, {
        logoUrl,
      });
      if (existing.logoUrl && existing.logoUrl !== logoUrl) {
        await deleteFileByUrl(tenantId, existing.logoUrl);
      }
      return response.status(200).send(settings);
    } catch (error) {
      logger.error("Could not upload platform logo", error);
      return sendError(response, error, "Could not upload platform logo");
    }
  }

  static async removeLogo(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const existing = await PlatformSettingsService.getSettings(tenantId);
      await deleteFileByUrl(tenantId, existing.logoUrl);
      const settings = await PlatformSettingsService.updateSettings(tenantId, {
        logoUrl: "",
      });
      return response.status(200).send(settings);
    } catch (error) {
      logger.error("Could not remove platform logo", error);
      return sendError(response, error, "Could not remove platform logo");
    }
  }
}

module.exports = SettingsController;
