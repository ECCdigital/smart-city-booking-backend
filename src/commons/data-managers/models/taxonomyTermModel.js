const mongoose = require("mongoose");
const taxonomyTermSchemaDefinition = require("../../schemas/taxonomyTermSchema");

const { Schema } = mongoose;

const TaxonomyTermSchema = new Schema(taxonomyTermSchemaDefinition);

TaxonomyTermSchema.index({ tenantId: 1, type: 1, name: 1 }, { unique: true });

TaxonomyTermSchema.methods.toEntity = function () {
  const TaxonomyTerm = require("../../entities/taxonomy/taxonomyTerm");
  return new TaxonomyTerm(this.toObject());
};

module.exports =
  mongoose.models.TaxonomyTerm ||
  mongoose.model("TaxonomyTerm", TaxonomyTermSchema, "taxonomy_terms");
