const mongoose = require("mongoose");
const { catalogSchemaDefinition } = require("../../schemas/catalogSchema");

const { Schema } = mongoose;

const CatalogSchema = new Schema(catalogSchemaDefinition);

CatalogSchema.methods.toEntity = function () {
  const { Catalog } = require("../../entities/catalog/catalog");
  return new Catalog(this.toObject());
};

module.exports =
  mongoose.models.Catalog || mongoose.model("Catalog", CatalogSchema);
