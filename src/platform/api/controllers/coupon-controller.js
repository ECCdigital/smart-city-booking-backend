const CouponManager = require("../../../commons/data-managers/coupon-manager");
const TenantManager = require("../../../commons/data-managers/tenant-manager");
const { Coupon } = require("../../../commons/entities/coupon/coupon");
const { ForbiddenError } = require("../../../errors/BaseError");
const { scopeOf } = require("../../../commons/services/authorization");
const bunyan = require("bunyan");
const CouponService = require("../../../commons/services/coupon-service");

const logger = bunyan.createLogger({
  name: "coupon-controller.js",
  level: process.env.LOG_LEVEL,
});

class CouponController {
  static async storeCoupon(request, response, next) {
    const tenant = request.params.tenant;
    try {
      const coupon = new Coupon(request.body);

      if (!coupon) {
        return response.status(400).send("Coupon is required");
      }

      let isUpdate = false;
      // The coupon within the reach of the main action: a coupon out of
      // reach is not there, and the creation runs into the unique key.
      const existingCoupon = await CouponManager.getCoupon(
        coupon.id,
        tenant,
        scopeOf(request),
      );

      if (existingCoupon) {
        isUpdate = true;
      }

      if (isUpdate) {
        await CouponController.updateCoupon(request, response);
      } else {
        await CouponController.createCoupon(request, response, next);
      }
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not store coupon");
    }
  }

  /**
   * The obsolete PUT carries the update marker and names the creation as
   * its second question (`also: ["create"]`, ADR 0001).
   */
  static async createCoupon(request, response, next) {
    try {
      const tenant = request.params.tenant;
      const user = request.user;
      const coupon = new Coupon(request.body);

      coupon.tenantId = tenant;

      if (request.reaches?.create !== "any") {
        logger.warn(
          `User ${user?.id} not allowed to create coupons ${coupon?.id}`,
        );
        return next(new ForbiddenError());
      }

      try {
        coupon.ownerUserId = user.id;
        const updatedCoupon = await CouponService.createCoupon(coupon, tenant);
        logger.info(
          `${tenant} -- created coupon ${coupon.id} by user ${user?.id}`,
        );
        response.status(201).send(updatedCoupon);
      } catch (err) {
        logger.error(err);
        return response.status(400).send(err.message);
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

      // The coupon within the reach of the request; none there is a 404.
      const existingCoupon = await CouponManager.getCoupon(
        coupon.id,
        tenant,
        scopeOf(request),
      );
      if (!existingCoupon) {
        return response.status(404).send("Coupon not found");
      }

      try {
        const updatedCoupon = await CouponService.updateCoupon(coupon, tenant);
        logger.info(
          `${tenant} -- updated coupon ${coupon.id} by user ${user?.id}`,
        );
        response.status(201).send(updatedCoupon);
      } catch (err) {
        logger.error(err);
        return response.status(400).send(err.message);
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

      const allowedCoupons = await CouponManager.getCoupons(
        tenant,
        scopeOf(request),
      );

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

    console.log(`Getting coupon with id ${id} for tenant ${tenant}`);

    // The lookup asks as the public (`coupon.lookup`): a tenant without a
    // public projection has no coupons to look up (ADR 0003), the 404
    // names no reason.
    if (!(await TenantManager.getTenant(tenant, scopeOf(request)))) {
      return response.status(404).send("Coupon not found");
    }

    const doesExist = await CouponManager.exists(id, tenant);
    if (!doesExist) {
      return response.status(404).send("Coupon not found");
    }

    const coupon = await CouponManager.getCoupon(id, tenant, scopeOf(request));
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

      // The coupon within the reach of the request; none there is a 404.
      const coupon = await CouponManager.getCoupon(
        id,
        tenant,
        scopeOf(request),
      );
      if (!coupon) {
        return response.status(404).send("Coupon not found");
      }

      await CouponManager.removeCoupon(id, tenant);
      logger.info(
        `${tenant} -- removed coupon ${coupon.id} by user ${user?.id}`,
      );
      response.status(204).send();
    } catch (err) {
      logger.error(err);
      response.status(500).send("Could not delete coupon");
    }
  }
}

module.exports = CouponController;
