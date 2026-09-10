const bunyan = require("bunyan");
const { v4: uuidv4 } = require("uuid");
const PostService = require("../../../commons/services/post-service");
const CompanyController = require("./company-controller");
const CompanyMemberManager = require("../../../commons/data-managers/company-member-manager");
const { sendError } = require("../../../commons/utilities/http-error");
const { deleteFileByUrl } = require("../../../commons/utilities/file-url");
const {
  MAX_IMAGE_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
} = require("../../../commons/utilities/upload-limits");
const {
  NextcloudManager,
} = require("../../../commons/data-managers/file-manager");

const logger = bunyan.createLogger({
  name: "post-controller.js",
  level: process.env.LOG_LEVEL,
});

const POST_MEDIA_DIR = "public/post-media";

class PostController {
  // ---- public (published-only, company-dashboard posts excluded) ----
  static async list(request, response) {
    try {
      const query = request.query || {};
      const result = await PostService.listPublic(request.params.tenant, {
        audience: query.audience,
        tag: query.tag,
        q: query.q,
        limit: query.limit,
        offset: query.offset,
      });
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not list posts", error);
      return sendError(response, error, "Could not list posts");
    }
  }

  static async getBySlug(request, response) {
    try {
      const result = await PostService.getPublicBySlug(
        request.params.tenant,
        request.params.slug,
      );
      return response.status(200).send(result);
    } catch (error) {
      return sendError(response, error, "Could not load post");
    }
  }

  static async tags(request, response) {
    try {
      const result = await PostService.publicTags(request.params.tenant);
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not list post tags", error);
      return sendError(response, error, "Could not list post tags");
    }
  }

  // ---- admin (KielRegion / platform admin) ----
  static async adminList(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await PostService.listForAdmin(tenantId);
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not list posts (admin)", error);
      return sendError(response, error, "Could not list posts");
    }
  }

  static async create(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await PostService.create(tenantId, request.body || {});
      return response.status(201).send(result);
    } catch (error) {
      logger.error("Could not create post", error);
      return sendError(response, error, "Could not create post");
    }
  }

  static async update(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await PostService.update(
        tenantId,
        request.params.id,
        request.body || {},
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not update post", error);
      return sendError(response, error, "Could not update post");
    }
  }

  static async publish(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await PostService.setPublished(
        tenantId,
        request.params.id,
        true,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not publish post", error);
      return sendError(response, error, "Could not publish post");
    }
  }

  static async unpublish(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await PostService.setPublished(
        tenantId,
        request.params.id,
        false,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not unpublish post", error);
      return sendError(response, error, "Could not unpublish post");
    }
  }

  static async remove(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await PostService.remove(tenantId, request.params.id);
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not delete post", error);
      return sendError(response, error, "Could not delete post");
    }
  }

  // ---- company dashboard feed (signed-in company member or admin) ----
  static async companyList(request, response) {
    try {
      const tenantId = request.params.tenant;
      const userId = request.user.id;
      const isAdmin = await CompanyController.isTenantAdmin(userId, tenantId);
      const member = isAdmin
        ? null
        : await CompanyMemberManager.getMemberByUser(tenantId, userId);
      if (!isAdmin && !member) {
        return response.sendStatus(403);
      }
      const result = await PostService.listForCompanyDashboard(tenantId);
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not list company posts", error);
      return sendError(response, error, "Could not list company posts");
    }
  }

  // ---- admin media: thumbnail image + PDF attachments ----
  static async uploadThumbnail(request, response) {
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
        return response.status(400).send("Thumbnail must be an image.");
      }
      if (file.data.length > MAX_IMAGE_BYTES) {
        return response.status(413).send("Image file is too large (max 8 MB).");
      }
      const existing = await PostService.getAdminById(
        tenantId,
        request.params.id,
      );
      const url = await PostController._storeFile(
        tenantId,
        request.params.id,
        file,
      );
      const post = await PostService.setThumbnail(
        tenantId,
        request.params.id,
        url,
      );
      if (existing.thumbnailUrl && existing.thumbnailUrl !== url) {
        await PostController._deletePostFile(tenantId, existing.thumbnailUrl);
      }
      return response.status(200).send(post);
    } catch (error) {
      logger.error("Could not upload post thumbnail", error);
      return sendError(response, error, "Could not upload thumbnail");
    }
  }

  static async removeThumbnail(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const existing = await PostService.getAdminById(
        tenantId,
        request.params.id,
      );
      await PostController._deletePostFile(tenantId, existing.thumbnailUrl);
      const post = await PostService.setThumbnail(
        tenantId,
        request.params.id,
        "",
      );
      return response.status(200).send(post);
    } catch (error) {
      logger.error("Could not remove post thumbnail", error);
      return sendError(response, error, "Could not remove thumbnail");
    }
  }

  static async uploadAttachment(request, response) {
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
      // The client-supplied mimetype is spoofable, so also require the PDF magic bytes.
      const isPdf =
        file.mimetype === "application/pdf" &&
        file.data.slice(0, 5).toString("latin1") === "%PDF-";
      if (!isPdf) {
        return response.status(400).send("Attachment must be a PDF.");
      }
      if (file.data.length > MAX_ATTACHMENT_BYTES) {
        return response.status(413).send("PDF file is too large (max 20 MB).");
      }
      const existing = await PostService.getAdminById(
        tenantId,
        request.params.id,
      );
      if ((existing.attachments || []).length >= MAX_ATTACHMENTS) {
        return response
          .status(400)
          .send(`A post may have at most ${MAX_ATTACHMENTS} attachments.`);
      }
      const url = await PostController._storeFile(
        tenantId,
        request.params.id,
        file,
      );
      const attachment = {
        id: uuidv4(),
        filename: file.name,
        url,
        size: file.data.length,
        created: Date.now(),
      };
      const post = await PostService.addAttachment(
        tenantId,
        request.params.id,
        attachment,
      );
      return response.status(201).send(post);
    } catch (error) {
      logger.error("Could not upload post attachment", error);
      return sendError(response, error, "Could not upload attachment");
    }
  }

  static async removeAttachment(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const { removedUrl, post } = await PostService.removeAttachment(
        tenantId,
        request.params.id,
        request.params.attId,
      );
      await PostController._deletePostFile(tenantId, removedUrl);
      return response.status(200).send(post);
    } catch (error) {
      logger.error("Could not remove post attachment", error);
      return sendError(response, error, "Could not remove attachment");
    }
  }

  static async _storeFile(tenantId, postId, file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const bareName = `${postId}-${uuidv4()}-${safeName}`;
    await NextcloudManager.createFile({
      tenantID: tenantId,
      file: { name: bareName, data: file.data },
      subFolder: POST_MEDIA_DIR,
    });
    return `${process.env.BACKEND_URL}/api/${tenantId}/files/get?name=/${POST_MEDIA_DIR}/${bareName}`;
  }

  static async _deletePostFile(tenantId, url) {
    await deleteFileByUrl(tenantId, url);
  }
}

module.exports = PostController;
