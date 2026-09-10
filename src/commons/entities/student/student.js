const studentSchemaDefinition = require("../../schemas/studentSchema");
const SchemaUtils = require("../../utilities/schemaUtils");

class Student {
  constructor(params = {}) {
    Object.assign(this, SchemaUtils.createDefaults(studentSchemaDefinition));

    Object.keys(studentSchemaDefinition).forEach((key) => {
      if (params[key] !== undefined) {
        this[key] = params[key];
      }
    });
  }

  validate() {
    return SchemaUtils.validate(this, studentSchemaDefinition);
  }

  static create(params) {
    const student = new Student(params);
    student.validate();
    return student;
  }
}

module.exports = Student;
