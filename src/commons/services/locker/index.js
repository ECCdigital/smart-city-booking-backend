const { registerLocker } = require("./locker-registry");
const { ParevaLocker } = require("./locker");
const { IfbsLocker } = require("./ifbs-locker");

registerLocker("pareva", ParevaLocker);
registerLocker("ifbs", IfbsLocker);