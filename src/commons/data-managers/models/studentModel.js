const mongoose = require("mongoose");
const studentSchemaDefinition = require("../../schemas/studentSchema");

const { Schema } = mongoose;

const StudentSchema = new Schema(studentSchemaDefinition);

StudentSchema.index({ userId: 1 }, { unique: true });
StudentSchema.index({ tenantId: 1 });
StudentSchema.index({ guardianConsentTokenHash: 1 });

StudentSchema.methods.toEntity = function () {
  const Student = require("../../entities/student/student");
  return new Student(this.toObject());
};

module.exports =
  mongoose.models.Student ||
  mongoose.model("Student", StudentSchema, "students");
