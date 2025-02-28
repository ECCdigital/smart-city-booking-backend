const mongoose = require("mongoose");
const { Coupon } = require("../../entities/coupon");
const { Schema } = mongoose;

const CouponSchema = new Schema(Coupon.schema);

module.exports =
  mongoose.models.Coupon || mongoose.model("Coupon", CouponSchema);
