const bunyan = require("bunyan");
const CompanyService = require("../../../commons/services/company/company-service");
const CompanyManager = require("../../../commons/data-managers/company-manager");
const CompanyMemberManager = require("../../../commons/data-managers/company-member-manager");
const {
  NextcloudManager,
} = require("../../../commons/data-managers/file-manager");
const { v4: uuidv4 } = require("uuid");
const { sendError } = require("../../../commons/utilities/http-error");
const { deleteFileByUrl } = require("../../../commons/utilities/file-url");
const {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} = require("../../../commons/utilities/upload-limits");

const logger = bunyan.createLogger({
  name: "company-controller.js",
  level: process.env.LOG_LEVEL,
});

const COMPANY_STATUS_FILTERS = ["unverified", "verified", "blocked"];

class CompanyController {
  static async register(request, response) {
    try {
      const tenantId = request.params.tenant;
      const company = await CompanyService.registerCompany(
        tenantId,
        request.body,
      );
      return response
        .status(201)
        .send({ id: company.id, status: company.status });
    } catch (error) {
      logger.error("Could not register company", error);
      return sendError(response, error, "Could not register company");
    }
  }

  static async resendVerification(request, response) {
    try {
      const tenantId = request.params.tenant;
      await CompanyService.resendVerification(
        tenantId,
        request.body.email,
        request.body.nextUrl,
      );
      return response.status(200).send({
        message:
          "If an unverified account exists for this email, a verification email has been sent.",
      });
    } catch (error) {
      logger.error("Could not resend verification", error);
      return sendError(response, error, "Could not resend verification");
    }
  }

  static async getCompanies(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const status = COMPANY_STATUS_FILTERS.includes(request.query.status)
        ? request.query.status
        : undefined;
      // opt-in pagination: with `limit` → { items, total }, else the full array
      const limit = parseInt(request.query.limit, 10);
      if (Number.isFinite(limit) && limit > 0) {
        const offset = Math.max(0, parseInt(request.query.offset, 10) || 0);
        const q =
          typeof request.query.q === "string" ? request.query.q.trim() : "";
        const { items, total } = await CompanyManager.getCompaniesPage(
          tenantId,
          { status, q, limit: Math.min(limit, 100), offset },
        );
        return response
          .status(200)
          .send({ items: items.map(CompanyController._withLatLng), total });
      }
      const filter = status ? { status } : {};
      const companies = await CompanyManager.getCompanies(tenantId, filter);
      return response
        .status(200)
        .send(companies.map(CompanyController._withLatLng));
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static _withLatLng(company) {
    if (!company) {
      return company;
    }
    const coords =
      company.location && Array.isArray(company.location.coordinates)
        ? company.location.coordinates
        : null;
    const dto = { ...company };
    delete dto.location;
    dto.lat = coords ? coords[1] : null;
    dto.lng = coords ? coords[0] : null;
    return dto;
  }

  static async getMyCompany(request, response) {
    try {
      const tenantId = request.params.tenant;
      const member = await CompanyMemberManager.getMemberByUser(
        tenantId,
        request.user.id,
      );
      if (!member) {
        return response.sendStatus(404);
      }
      const company = await CompanyManager.getCompany(
        tenantId,
        member.companyId,
      );
      if (!company) {
        return response.sendStatus(404);
      }
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async getMyContext(request, response) {
    try {
      const tenantId = request.params.tenant;
      const userId = request.user.id;

      if (await CompanyController.isTenantAdmin(userId, tenantId)) {
        return response.status(200).send({
          role: "admin",
          companyId: null,
          isOwner: false,
          branchId: "",
        });
      }

      const member = await CompanyMemberManager.getMemberByUser(
        tenantId,
        userId,
      );
      if (member) {
        return response.status(200).send({
          role: member.isOwner ? "company_owner" : "company_member",
          companyId: member.companyId,
          isOwner: member.isOwner === true,
          branchId: member.branchId || "",
        });
      }

      return response.status(200).send({
        role: "student",
        companyId: null,
        isOwner: false,
        branchId: "",
      });
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async getCompany(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;

      const company = await CompanyManager.getCompany(tenantId, companyId);
      if (!company) {
        return response.sendStatus(404);
      }

      const isAdmin = await CompanyController.isTenantAdmin(
        request.user.id,
        tenantId,
      );
      const member = await CompanyMemberManager.getMemberByUser(
        tenantId,
        request.user.id,
      );
      const isMember = member !== null && member.companyId === companyId;
      if (!isAdmin && !isMember) {
        return response.sendStatus(403);
      }
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async getPublicCompany(request, response) {
    try {
      const tenantId = request.params.tenant;
      const company = await CompanyManager.getCompany(
        tenantId,
        request.params.id,
      );
      if (!company || company.status !== "verified") {
        return response.sendStatus(404);
      }
      const media = await CompanyService.getCompanyMedia(
        tenantId,
        request.params.id,
      );
      const branches = await CompanyService.getCompanyBranches(
        tenantId,
        request.params.id,
      );
      return response.status(200).send({
        id: company.id,
        name: company.name,
        slug: company.slug,
        mail: company.mail,
        phone: company.phone,
        website: company.website,
        street: company.street,
        postalCode: company.postalCode,
        city: company.city,
        districtId: company.districtId,
        industryId: company.industryId,
        sizeId: company.sizeId,
        logoUrl: company.logoUrl,
        description: company.description,
        acceptsUnsolicitedApplications:
          company.acceptsUnsolicitedApplications === true,
        lat:
          company.location && Array.isArray(company.location.coordinates)
            ? company.location.coordinates[1]
            : null,
        lng:
          company.location && Array.isArray(company.location.coordinates)
            ? company.location.coordinates[0]
            : null,
        media: media.map((item) => ({
          id: item.id,
          url: item.url,
          type: item.type,
          created: item.created,
        })),
        branches,
      });
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async getUnsolicitedCompanies(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companies = await CompanyManager.getCompanies(tenantId, {
        status: "verified",
        acceptsUnsolicitedApplications: true,
      });
      return response.status(200).send(
        companies.map((company) => ({
          id: company.id,
          name: company.name,
          slug: company.slug,
          logoUrl: company.logoUrl,
          industryId: company.industryId,
          city: company.city,
          districtId: company.districtId,
        })),
      );
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async updateProfile(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._isManager(access)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const company = await CompanyService.updateCompanyProfile(
        tenantId,
        companyId,
        request.body,
      );
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error("Could not update company profile", error);
      return sendError(response, error, "Could not update company profile");
    }
  }

  static async uploadLogo(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._isManager(access)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
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
      const existing = await CompanyManager.getCompany(tenantId, companyId);
      if (!existing) {
        return response.sendStatus(404);
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `${companyId}-${safeName}`;
      await NextcloudManager.createFile({
        tenantID: tenantId,
        file: { name: fileName, data: file.data },
        subFolder: "public/logos",
      });
      const logoUrl = `${process.env.BACKEND_URL}/api/${tenantId}/files/get?name=/public/logos/${encodeURIComponent(fileName)}`;
      const company = await CompanyService.setCompanyLogo(
        tenantId,
        companyId,
        logoUrl,
      );
      if (existing.logoUrl && existing.logoUrl !== logoUrl) {
        await CompanyController._deleteLogoFile(tenantId, existing.logoUrl);
      }
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error("Could not upload logo", error);
      return sendError(response, error, "Could not upload logo");
    }
  }

  static async removeLogo(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._isManager(access)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const existing = await CompanyManager.getCompany(tenantId, companyId);
      if (!existing) {
        return response.sendStatus(404);
      }
      await CompanyController._deleteLogoFile(tenantId, existing.logoUrl);
      const company = await CompanyService.removeCompanyLogo(
        tenantId,
        companyId,
      );
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error("Could not remove logo", error);
      return sendError(response, error, "Could not remove logo");
    }
  }

  static async listMedia(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;
      if (
        !(await CompanyController.isMemberOrAdmin(
          request.user.id,
          tenantId,
          companyId,
        ))
      ) {
        return response.sendStatus(403);
      }
      const media = await CompanyService.getCompanyMedia(tenantId, companyId);
      return response.status(200).send(media);
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async uploadMedia(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._isManager(access)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
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
      const isVideo = !!(file.mimetype && file.mimetype.startsWith("video/"));
      const isImage = !!(file.mimetype && file.mimetype.startsWith("image/"));
      if (!isImage && !isVideo) {
        return response.status(400).send("Media must be an image or video.");
      }
      if (file.data.length > (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
        return response
          .status(413)
          .send("Media file is too large (max 8 MB image / 100 MB video).");
      }
      const existing = await CompanyManager.getCompany(tenantId, companyId);
      if (!existing) {
        return response.sendStatus(404);
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const bareName = `${companyId}-${uuidv4()}-${safeName}`;
      await NextcloudManager.createFile({
        tenantID: tenantId,
        file: { name: bareName, data: file.data },
        subFolder: "public/media",
      });
      const fileName = `public/media/${bareName}`;
      const url = `${process.env.BACKEND_URL}/api/${tenantId}/files/get?name=/${fileName}`;
      const type = isVideo ? "video" : "image";
      let media;
      try {
        media = await CompanyService.addCompanyMedia(tenantId, companyId, {
          url,
          fileName,
          type,
        });
      } catch (mediaError) {
        // remove the orphaned blob if the DB save was rejected
        try {
          await NextcloudManager.deleteFile(tenantId, fileName);
        } catch {
          // best-effort
        }
        throw mediaError;
      }
      return response.status(201).send(media);
    } catch (error) {
      logger.error("Could not upload media", error);
      return sendError(response, error, "Could not upload media");
    }
  }

  static async removeMedia(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._isManager(access)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const media = await CompanyService.removeCompanyMedia(
        tenantId,
        companyId,
        request.params.mediaId,
      );
      if (media.fileName) {
        try {
          await NextcloudManager.deleteFile(tenantId, media.fileName);
        } catch (e) {
          logger.warn(`Could not delete media file: ${e.message}`);
        }
      }
      return response.status(200).send({ id: media.id });
    } catch (error) {
      logger.error("Could not remove media", error);
      return sendError(response, error, "Could not remove media");
    }
  }

  static async verify(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const company = await CompanyService.verifyCompany(
        tenantId,
        request.params.id,
      );
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error("Could not verify company", error);
      return sendError(response, error, "Could not verify company");
    }
  }

  static async block(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const company = await CompanyService.blockCompany(
        tenantId,
        request.params.id,
      );
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error("Could not block company", error);
      return sendError(response, error, "Could not block company");
    }
  }

  static async unverify(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const company = await CompanyService.unverifyCompany(
        tenantId,
        request.params.id,
      );
      return response.status(200).send(CompanyController._withLatLng(company));
    } catch (error) {
      logger.error("Could not unverify company", error);
      return sendError(response, error, "Could not unverify company");
    }
  }

  static async adminCreate(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await CompanyService.adminCreateCompany(
        tenantId,
        request.body,
      );
      return response.status(201).send({
        id: result.company.id,
        status: result.company.status,
        invitation: result.invitation,
      });
    } catch (error) {
      logger.error("Could not create company", error);
      return sendError(response, error, "Could not create company");
    }
  }

  static async adminDelete(request, response) {
    try {
      const tenantId = request.params.tenant;
      if (!(await CompanyController.isTenantAdmin(request.user.id, tenantId))) {
        return response.sendStatus(403);
      }
      const result = await CompanyService.adminDeleteCompany(
        tenantId,
        request.params.id,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not delete company", error);
      return sendError(response, error, "Could not delete company");
    }
  }

  static async listBranches(request, response) {
    try {
      const tenantId = request.params.tenant;
      const companyId = request.params.id;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!access.isAdmin && !access.member) {
        return response.sendStatus(403);
      }
      let branches = await CompanyService.getCompanyBranches(
        tenantId,
        companyId,
      );
      const scope = CompanyController._memberBranchScope(access);
      if (scope !== null) {
        branches = branches.filter((b) => b.id === scope);
      }
      return response.status(200).send(branches);
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async getBranch(request, response) {
    try {
      const { tenant: tenantId, id: companyId, branchId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!access.isAdmin && !access.member) {
        return response.sendStatus(403);
      }
      const scope = CompanyController._memberBranchScope(access);
      if (scope !== null && branchId !== scope) {
        return response.sendStatus(403);
      }
      const branch = await CompanyService.getCompanyBranch(
        tenantId,
        companyId,
        branchId,
      );
      return response.status(200).send(branch);
    } catch (error) {
      logger.error("Could not get branch", error);
      return sendError(response, error, "Could not get branch");
    }
  }

  static async createBranch(request, response) {
    try {
      const { tenant: tenantId, id: companyId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._isManager(access)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const branch = await CompanyService.createCompanyBranch(
        tenantId,
        companyId,
        request.body,
      );
      return response.status(201).send(branch);
    } catch (error) {
      logger.error("Could not create branch", error);
      return sendError(response, error, "Could not create branch");
    }
  }

  static async updateBranch(request, response) {
    try {
      const { tenant: tenantId, id: companyId, branchId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._canEditBranch(access, branchId)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const branch = await CompanyService.updateCompanyBranch(
        tenantId,
        companyId,
        branchId,
        request.body,
      );
      return response.status(200).send(branch);
    } catch (error) {
      logger.error("Could not update branch", error);
      return sendError(response, error, "Could not update branch");
    }
  }

  static async removeBranch(request, response) {
    try {
      const { tenant: tenantId, id: companyId, branchId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._isManager(access)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const branch = await CompanyService.removeCompanyBranch(
        tenantId,
        companyId,
        branchId,
      );
      await CompanyController._deleteLogoFile(tenantId, branch.logoUrl);
      return response.status(200).send({ id: branch.id });
    } catch (error) {
      logger.error("Could not remove branch", error);
      return sendError(response, error, "Could not remove branch");
    }
  }

  static async uploadBranchLogo(request, response) {
    try {
      const { tenant: tenantId, id: companyId, branchId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._canEditBranch(access, branchId)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
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
      const existing = await CompanyService.getCompanyBranch(
        tenantId,
        companyId,
        branchId,
      );
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `${branchId}-${safeName}`;
      await NextcloudManager.createFile({
        tenantID: tenantId,
        file: { name: fileName, data: file.data },
        subFolder: "public/branch-logos",
      });
      const logoUrl = `${process.env.BACKEND_URL}/api/${tenantId}/files/get?name=/public/branch-logos/${encodeURIComponent(fileName)}`;
      const branch = await CompanyService.setBranchLogo(
        tenantId,
        companyId,
        branchId,
        logoUrl,
      );
      if (existing.logoUrl && existing.logoUrl !== logoUrl) {
        await CompanyController._deleteLogoFile(tenantId, existing.logoUrl);
      }
      return response.status(200).send(branch);
    } catch (error) {
      logger.error("Could not upload branch logo", error);
      return sendError(response, error, "Could not upload branch logo");
    }
  }

  static async removeBranchLogo(request, response) {
    try {
      const { tenant: tenantId, id: companyId, branchId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!CompanyController._canEditBranch(access, branchId)) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const existing = await CompanyService.getCompanyBranch(
        tenantId,
        companyId,
        branchId,
      );
      await CompanyController._deleteLogoFile(tenantId, existing.logoUrl);
      const branch = await CompanyService.removeBranchLogo(
        tenantId,
        companyId,
        branchId,
      );
      return response.status(200).send(branch);
    } catch (error) {
      logger.error("Could not remove branch logo", error);
      return sendError(response, error, "Could not remove branch logo");
    }
  }

  static async inviteMember(request, response) {
    try {
      const { tenant: tenantId, id: companyId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      const targetBranchId = (request.body && request.body.branchId) || "";
      const scope = CompanyController._memberBranchScope(access);
      if (
        !CompanyController._isManager(access) &&
        !(access.member !== null && scope === targetBranchId)
      ) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const invitation = await CompanyService.inviteMember(
        tenantId,
        companyId,
        request.user.id,
        request.body,
      );
      return response.status(201).send(invitation);
    } catch (error) {
      logger.error("Could not invite member", error);
      return sendError(response, error, "Could not invite member");
    }
  }

  static async listMembers(request, response) {
    try {
      const { tenant: tenantId, id: companyId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!access.isAdmin && !access.member) {
        return response.sendStatus(403);
      }
      let members = await CompanyService.listCompanyMembers(
        tenantId,
        companyId,
      );
      const scope = CompanyController._memberBranchScope(access);
      if (scope !== null) {
        members = members.filter((m) => (m.branchId || "") === scope);
      }
      return response.status(200).send(members);
    } catch (error) {
      logger.error(error);
      return response.sendStatus(500);
    }
  }

  static async removeMember(request, response) {
    try {
      const { tenant: tenantId, id: companyId, userId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!access.isAdmin && !access.member) {
        return response.sendStatus(403);
      }
      if (
        !(await CompanyController.hasAdminPermission(
          access,
          request.user.id,
          tenantId,
          "companies:edit",
        ))
      ) {
        return response.sendStatus(403);
      }
      const scope = CompanyController._memberBranchScope(access);
      const result = await CompanyService.removeCompanyMember(
        tenantId,
        companyId,
        userId,
        scope,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not remove member", error);
      return sendError(response, error, "Could not remove member");
    }
  }

  static async deleteAccount(request, response) {
    try {
      const { tenant: tenantId, id: companyId } = request.params;
      const access = await CompanyController.getBranchAccess(
        request.user.id,
        tenantId,
        companyId,
      );
      if (!access.member || access.member.isOwner !== true) {
        return response.sendStatus(403);
      }
      const result = await CompanyService.deleteOwnerAccount(
        tenantId,
        companyId,
        request.user.id,
        request.body && request.body.reason,
      );
      return response.status(200).send(result);
    } catch (error) {
      if (error && error.status === 409) {
        return response.status(409).send({
          message: error.message,
          memberCount: error.memberCount,
          branchCount: error.branchCount,
          offerCount: error.offerCount,
        });
      }
      logger.error("Could not delete company account", error);
      return sendError(response, error, "Could not delete company account");
    }
  }

  static async acceptInvitation(request, response) {
    try {
      const tenantId = request.params.tenant;
      const result = await CompanyService.acceptMemberInvitation(
        tenantId,
        request.params.token,
        request.body.password,
      );
      return response.status(200).send(result);
    } catch (error) {
      logger.error("Could not accept invitation", error);
      return sendError(response, error, "Could not accept invitation");
    }
  }

  static async isTenantAdmin(userId, tenantId) {
    // admin status comes from admin_users, not legacy RBAC
    const AdminAccessService = require("../../../commons/services/admin-access/admin-access-service");
    return AdminAccessService.isAdmin(userId, tenantId);
  }

  static _isManager(access) {
    return (
      access.isAdmin ||
      (access.member !== null &&
        (access.member.isOwner === true || access.member.branchId === ""))
    );
  }

  static _memberBranchScope(access) {
    if (CompanyController._isManager(access) || access.member === null) {
      return null;
    }
    return access.member.branchId;
  }

  static async isCompanyManager(userId, tenantId, companyId) {
    const access = await CompanyController.getBranchAccess(
      userId,
      tenantId,
      companyId,
    );
    return CompanyController._isManager(access);
  }

  static async isMemberOrAdmin(userId, tenantId, companyId) {
    if (await CompanyController.isTenantAdmin(userId, tenantId)) {
      return true;
    }
    const member = await CompanyMemberManager.getMemberByUser(tenantId, userId);
    return member !== null && member.companyId === companyId;
  }

  static async getBranchAccess(userId, tenantId, companyId) {
    if (await CompanyController.isTenantAdmin(userId, tenantId)) {
      return { isAdmin: true, member: null };
    }
    const member = await CompanyMemberManager.getMemberByUser(tenantId, userId);
    const isMember = member !== null && member.companyId === companyId;
    return { isAdmin: false, member: isMember ? member : null };
  }

  static _canEditBranch(access, branchId) {
    if (access.isAdmin) {
      return true;
    }
    const member = access.member;
    return (
      member !== null &&
      (member.isOwner === true ||
        member.branchId === "" ||
        member.branchId === branchId)
    );
  }

  static async canEditBranch(userId, tenantId, companyId, branchId) {
    const access = await CompanyController.getBranchAccess(
      userId,
      tenantId,
      companyId,
    );
    return CompanyController._canEditBranch(access, branchId);
  }

  // a non-member admin must also hold the granular permission (members: branch scope)
  static async hasAdminPermission(access, userId, tenantId, permission) {
    if (!access.isAdmin || access.member !== null) {
      return true;
    }
    const AdminAccessService = require("../../../commons/services/admin-access/admin-access-service");
    return AdminAccessService.hasPermission(userId, tenantId, permission);
  }

  static async _deleteLogoFile(tenantId, logoUrl) {
    await deleteFileByUrl(tenantId, logoUrl);
  }
}

module.exports = CompanyController;
