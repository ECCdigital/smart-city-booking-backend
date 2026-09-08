const bunyan = require("bunyan");
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

/**
 * Web Controller for the mail templates. The right is the router's
 * (`tenant.mailTemplates`: the tenant owner).
 */
class MailTemplateController {
  static async getDefaultTemplates(request, response) {
    try {
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
