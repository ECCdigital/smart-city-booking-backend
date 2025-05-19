const mongoose = require("mongoose");
const { Bookable } = require("../../entities/bookable");

const { Schema } = mongoose;

const BookableSchema = new Schema(Bookable.schema);

module.exports =
  mongoose.models.Bookable || mongoose.model("Bookable", BookableSchema);
