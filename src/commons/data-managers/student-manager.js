const Student = require("../entities/student/student");
const StudentModel = require("./models/studentModel");

class StudentManager {
  static async getStudentByUser(userId) {
    const raw = await StudentModel.findOne({ userId });
    if (!raw) {
      return null;
    }
    return raw.toEntity();
  }

  static async listStudents(tenantId) {
    const raw = await StudentModel.find({ tenantId });
    return raw.map((doc) => doc.toEntity());
  }

  static async storeStudent(student, upsert = true) {
    const studentEntity =
      student instanceof Student ? student : new Student(student);
    studentEntity.validate();
    await StudentModel.updateOne(
      { userId: studentEntity.userId },
      { ...studentEntity },
      { upsert, setDefaultsOnInsert: true, runValidators: true },
    );
    return studentEntity;
  }

  static async removeStudent(userId) {
    await StudentModel.deleteOne({ userId });
  }
}

module.exports = StudentManager;
