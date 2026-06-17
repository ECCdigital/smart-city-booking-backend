const registry = require("./checkout-provider-registry");
const IfbsCheckoutProvider = require("./ifbs-checkout-provider");
const ParevaCheckoutProvider = require("./pareva-checkout-provider");

registry.register("ifbs", IfbsCheckoutProvider);
registry.register("pareva", ParevaCheckoutProvider);

module.exports = registry;