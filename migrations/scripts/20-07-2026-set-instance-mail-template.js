const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.join(
  __dirname,
  "../../src/commons/mail-service/templates",
);

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");
}

// Brands instance.mailTemplate with the KielRegion template (data only).
module.exports = {
  name: "20-07-2026-set-instance-mail-template",

  up: async function (mongoose) {
    const template = readTemplate("praktikum-mail-template.temp.html");
    const original = readTemplate("default-generic-mail-template.temp.html");
    const InstanceModel = mongoose.model("Instance");
    await InstanceModel.updateMany(
      { mailTemplate: original },
      { $set: { mailTemplate: template } },
    );
  },

  down: async function (mongoose) {
    const template = readTemplate("praktikum-mail-template.temp.html");
    const original = readTemplate("default-generic-mail-template.temp.html");
    const InstanceModel = mongoose.model("Instance");
    await InstanceModel.updateMany(
      { mailTemplate: template },
      { $set: { mailTemplate: original } },
    );
  },
};
