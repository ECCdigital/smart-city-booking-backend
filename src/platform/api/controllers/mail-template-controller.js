const bunyan = require("bunyan");
const PermissionService = require("../../../commons/services/permission-service");
const {
  DEFAULT_MAIL_SNIPPETS,
} = require("../../../commons/mail-service/templates/default-mail-snippets");
const {
  OVERRIDABLE_SNIPPETS,
  OVERRIDE_TEMPLATE_VARIABLES,
} = require("../../../commons/mail-service/templates/mail-snippet-overrides");

const logger = bunyan.createLogger({
  name: "mail-template-controller.js",
  level: process.env.LOG_LEVEL,
});

class MailTemplateController {
  static async getDefaultTemplates(request, response) {
    try {
      const tenantId = request.params.id;
      const user = request.user;

      if (
        !(await PermissionService._isTenantOwner(user.id, tenantId)) &&
        !(await PermissionService._isInstanceOwner(user.id))
      ) {
        return response.sendStatus(403);
      }

      response.status(200).send({
        mailSnippets: DEFAULT_MAIL_SNIPPETS,
        overridableSnippets: OVERRIDABLE_SNIPPETS,
        templateVariables: OVERRIDE_TEMPLATE_VARIABLES,
      });
    } catch (error) {
      logger.error(error);
      response.status(500).send("Could not get default mail templates");
    }
  }
}

module.exports = MailTemplateController;
