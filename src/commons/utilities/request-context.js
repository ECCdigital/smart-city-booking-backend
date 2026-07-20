const { AsyncLocalStorage } = require("node:async_hooks");

// Per-request context so deep services can read the acting user.
const storage = new AsyncLocalStorage();

function run(request, next) {
  storage.run(request, next);
}

function getActorId() {
  const request = storage.getStore();
  return request && request.user ? request.user.id : undefined;
}

module.exports = { storage, run, getActorId };
