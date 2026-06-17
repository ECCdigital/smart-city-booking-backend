const TenantApplication = require("./tenantApplication");
const SecurityUtils = require("../../utilities/security-utils");

class CardAuthApplication extends TenantApplication {
  constructor(params = {}) {
    super({ type: "card-auth", ...params });

    // Identifikation & Anzeige
    this.label = params.label || "Card Authentication";
    this.description = params.description || "";
    this.enabled = params.enabled !== undefined ? params.enabled : false;

    // Microservice-Verbindung
    this.serviceUrl = params.serviceUrl || "";
    this.apiToken = params.apiToken || null;
    this.cardType = params.cardType || "";

    // Felddefinitionen für das Frontend
    this.publicIdField = {
      label: params.publicIdField?.label || "Card Number",
      placeholder:
        params.publicIdField?.placeholder || "Enter your card number",
      helpText: params.publicIdField?.helpText || "",
    };

    this.secretField = {
      label: params.secretField?.label || "Secret",
      placeholder: params.secretField?.placeholder || "Enter your secret",
      helpText: params.secretField?.helpText || "",
    };
  }

  decrypt() {
    if (this.apiToken) {
      this.apiToken = SecurityUtils.decrypt(this.apiToken);
    }
  }

  encrypt() {
    if (this.apiToken) {
      this.apiToken = SecurityUtils.encrypt(this.apiToken);
    }
  }

  removePrivateData() {
    delete this.apiToken;
  }

  /**
   * Returns the public config the frontend needs to render the login form.
   */
  toPublicConfig() {
    return {
      id: this.id,
      type: this.type,
      label: this.label,
      description: this.description,
      enabled: this.enabled,
      cardType: this.cardType,
      publicIdField: { ...this.publicIdField },
      secretField: { ...this.secretField },
    };
  }

  static get Schema() {
    return {
      ...super.Schema,
      label: { type: String, default: "Card Authentication" },
      description: { type: String, default: "" },
      enabled: { type: Boolean, default: false },
      serviceUrl: { type: String, default: "" },
      apiToken: { type: Object, default: null },
      cardType: { type: String, default: "" },
      publicIdField: {
        type: Object,
        default: {
          label: "Card Number",
          placeholder: "Enter your card number",
          helpText: "",
        },
      },
      secretField: {
        type: Object,
        default: {
          label: "Secret",
          placeholder: "Enter your secret",
          helpText: "",
        },
      },
    };
  }
}

module.exports = CardAuthApplication;
