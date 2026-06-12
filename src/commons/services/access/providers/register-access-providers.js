const { registerAccessProvider } = require("./access-provider-registry");
const IfbsAccessProvider = require("./ifbs-access-provider");
const NukiAccessProvider = require("./nuki-access-provider");
const SaltoKsAccessProvider = require("./salto-ks-access-provider");

registerAccessProvider("ifbs", IfbsAccessProvider);
registerAccessProvider("nuki", NukiAccessProvider);
registerAccessProvider("salto-ks", SaltoKsAccessProvider);
