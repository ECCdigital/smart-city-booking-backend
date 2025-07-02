const mongoose = require("mongoose");
const { couponSchemaDefinition } = require("../../schemas/couponSchema");
const { Schema } = mongoose;

const CouponSchema = new Schema(couponSchemaDefinition);

CouponSchema.methods.toEntity = function () {
  const { Coupon } = require("../../entities/coupon/coupon");
  return new Coupon(this.toObject());
};

module.exports =
  mongoose.models.Coupon || mongoose.model("Coupon", CouponSchema);
