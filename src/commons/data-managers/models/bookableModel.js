const mongoose = require("mongoose");
const { bookableSchemaDefinition } = require("../../schemas/bookableSchema");

const { Schema } = mongoose;

const BookableSchema = new Schema(bookableSchemaDefinition);

BookableSchema.methods.toEntity = function () {
  const { Bookable } = require("../../entities/bookable/bookable");
  return new Bookable(this.toObject());
};

module.exports =
  mongoose.models.Bookable || mongoose.model("Bookable", BookableSchema);
