const { registerAccessProvider } = require("./access-provider-registry");
const IfbsAccessProvider = require("./ifbs-access-provider");

registerAccessProvider("ifbs", IfbsAccessProvider);
