const RoleManager = require("../../../commons/data-managers/role-manager");
const { RolePermission } = require("../../../commons/entities/role");
const CouponManager = require("../../../commons/data-managers/coupon-manager");
const { Booking } = require("../../../commons/entities/booking");
const { Coupon } = require("../../../commons/entities/coupon");
const UserManager = require("../../../commons/data-managers/user-manager");
const bunyan = require("bunyan");

const logger = bunyan.createLogger({
  name: "coupon-controller.js",
  level: process.env.LOG_LEVEL,
});

class CouponPermissions {
  static _isOwner(coupon, userId, tenant) {
    return coupon.ownerUserId === userId && coupon.tenant === tenant;
  }

  static async _allowCreate(coupon, userId, tenant) {
    return (
      coupon.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_COUPONS,
        "create",
      ))
    );
  }

  static async _allowRead(coupon, userId, tenant) {
    if (
      coupon.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_COUPONS,
        "readAny",
      ))
    )
      return true;

    if (
      coupon.tenant === tenant &&
      CouponPermissions._isOwner(coupon, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_COUPONS,
        "readOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowUpdate(coupon, userId, tenant) {
    if (
      coupon.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_COUPONS,
        "updateAny",
      ))
    )
      return true;

    if (
      coupon.tenant === tenant &&
      CouponPermissions._isOwner(coupon, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_COUPONS,
        "updateOwn",
      ))
    )
      return true;

    return false;
  }

  static async _allowDelete(coupon, userId, tenant) {
    if (
      coupon.tenant === tenant &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_COUPONS,
        "deleteAny",
      ))
    )
      return true;

    if (
      coupon.tenant === tenant &&
      CouponPermissions._isOwner(coupon, userId, tenant) &&
      (await UserManager.hasPermission(
        userId,
        tenant,
        RolePermission.MANAGE_COUPONS,
        "deleteOwn",
      ))
    )
      return true;

    return false;
  }
}

class CouponController {
  static async storeCoupon(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const coupon = Object.assign(new Coupon(), request.body);

    if (!coupon) {
      return response.status(400).send("Coupon is required");
    }

    const isUpdate = !!CouponManager.getCoupon(coupon.id, tenant)._id;

    if (isUpdate) {
      await CouponController.updateCoupon(request, response);
    } else {
      await CouponController.createCoupon(request, response);
    }
  }

  static async createCoupon(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const coupon = Object.assign(new Coupon(), request.body);

    if (await CouponPermissions._allowCreate(coupon, user.id, tenant)) {
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
  }

  static async updateCoupon(request, response) {
    const tenant = request.params.tenant;
    const user = request.user;
    const coupon = Object.assign(new Coupon(), request.body);

    if (await CouponPermissions._allowUpdate(coupon, user.id, tenant)) {
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
  }

  static async getCoupons(request, response) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;

      const coupons = await CouponManager.getCoupons(tenant);

      let allowedCoupons = [];
      for (let coupon of coupons) {
        if (await CouponPermissions._allowRead(coupon, user.id, tenant)) {
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
    const user = request.user;
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

      if (await CouponPermissions._allowDelete(coupon, user.id, tenant)) {
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
