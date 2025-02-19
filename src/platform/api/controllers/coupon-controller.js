const { RolePermission } = require("../../../commons/entities/role");
const CouponManager = require("../../../commons/data-managers/coupon-manager");
const { Coupon } = require("../../../commons/entities/coupon");
const PermissionService = require("../../../commons/services/permission-service");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "coupon-controller.js",
  level: process.env.LOG_LEVEL,
});

class CouponController {
  static async storeCoupon(request, response) {
    const tenant = request.params.tenant;
    const coupon = new Coupon(request.body);

    if (!coupon) {
      return response.status(400).send("Coupon is required");
    }

    let isUpdate = false;
    const existingCoupon = await CouponManager.getCoupon(coupon.id, tenant);

    if(existingCoupon) {
      isUpdate = true;
    }

    if (isUpdate) {
      await CouponController.updateCoupon(request, response);
    } else {
      await CouponController.createCoupon(request, response);
    }
  }

  static async createCoupon(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const coupon = new Coupon(request.body);

      if (await PermissionService._allowCreate(coupon, user.id, tenant, RolePermission.MANAGE_COUPONS)) {
        try {
          coupon.ownerUserId = user.id;
          const updatedCoupon = await CouponManager.storeCoupon(coupon);
          logger.info(
            `${tenant} -- created coupon ${coupon.id} by user ${user?.id}`,
          );
          response.status(201).send(updatedCoupon);
        } catch (err) {
          logger.error(err);
          return response.status(400).send(err.message);
        }
      } else {
        logger.warn(
          `User ${user?.id} not allowed to create coupons ${coupon?.id}`,
        );
        response.status(403).send("You are not allowed to create coupons");
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not create coupon");
    }
  }

  static async updateCoupon(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const coupon = new Coupon(request.body);

      if (await PermissionService._allowUpdate(coupon, user.id, tenant, RolePermission.MANAGE_COUPONS)) {
        try {
          const updatedCoupon = await CouponManager.storeCoupon(coupon);
          logger.info(
            `${tenant} -- updated coupon ${coupon.id} by user ${user?.id}`,
          );
          response.status(201).send(updatedCoupon);
        } catch (err) {
          logger.error(err);
          return response.status(400).send(err.message);
        }
      } else {
        logger.warn(
          `User ${user?.id} is not allowed to update coupons ${coupon?.id}`,
        );
        response.status(403).send("You are not allowed to update this coupon");
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not update coupon");
    }
  }

  static async getCoupons(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const coupons = await CouponManager.getCoupons(tenant);

      let allowedCoupons = [];
      for (let coupon of coupons) {
        if (await PermissionService._allowRead(coupon, user.id, tenant, RolePermission.MANAGE_COUPONS)) {
          allowedCoupons.push(coupon);
        }
      }

      logger.info(
        `${tenant} -- Sending ${allowedCoupons.length} coupons to user ${user?.id}`,
      );
      response.status(200).send(allowedCoupons);
    } catch (err) {
      logger.error(err);
      response.status(500).send(err);
    }
  }

  static async getCoupon(request, response) {
    const tenant = request.params.tenant;
    const { id } = request.params;

    const coupon = await CouponManager.getCoupon(id, tenant);
    if (!coupon._id) {
      return response.status(404).send("Coupon not found");
    }

    try {
      if (!coupon.isValid()) {
        logger.warn(`${tenant} -- Coupon ${coupon.id} is not valid`);
        return response.status(400).send("Coupon is not available");
      }
      response.status(200).send(coupon);
    } catch (err) {
      logger.error(err);
      return response.status(400).send(err.message);
    }
  }

  static async deleteCoupon(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const { id } = request.params;

      const coupon = await CouponManager.getCoupon(id, tenant);

      if (await PermissionService._allowDelete(coupon, user.id, tenant, RolePermission.MANAGE_COUPONS)) {
        const removedCoupon = await CouponManager.removeCoupon(id, tenant);
        logger.info(
          `${tenant} -- removed coupon ${coupon.id} by user ${user?.id}`,
        );
        response.status(200).send(removedCoupon);
      } else {
        logger.warn(
          `User ${user?.id} is not allowed to delete coupon ${coupon?.id}`,
        );
        response.status(403).send("You are not allowed to delete this coupon");
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not delete coupon");
    }
  }
}

module.exports = CouponController;
