const AccessPointType = Object.freeze({
  LOCKER: "locker",
  DOOR: "door",
});

const AccessPointMode = Object.freeze({
  REMOTE: "remote",
  AUTHORIZATION: "authorization",
  BOTH: "both",
});

const AccessCapability = Object.freeze({
  REMOTE: "remote",
  AUTHORIZATION: "authorization",
});

const AccessPointState = Object.freeze({
  OPEN: "open",
  CLOSED: "closed",
  UNKNOWN: "unknown",
});

function deriveSupportedModes(capabilities = []) {
  const hasRemote = capabilities.includes(AccessCapability.REMOTE);
  const hasAuthorization = capabilities.includes(
    AccessCapability.AUTHORIZATION,
  );
  const modes = [];

  if (hasRemote) {
    modes.push(AccessPointMode.REMOTE);
  }

  if (hasAuthorization) {
    modes.push(AccessPointMode.AUTHORIZATION);
  }

  if (hasRemote && hasAuthorization) {
    modes.push(AccessPointMode.BOTH);
  }

  return modes;
}

class AccessPoint {
  constructor({
    id,
    tenant,
    type,
    provider,
    externalId,
    locationId,
    label,
    metadata,
  }) {
    this.id = id;
    this.tenant = tenant;
    this.type = type;
    this.provider = provider;
    this.externalId = externalId;
    this.locationId = locationId;
    this.label = label;
    this.metadata = metadata || {};
  }
}

module.exports = {
  AccessPoint,
  AccessCapability,
  AccessPointType,
  AccessPointMode,
  AccessPointState,
  deriveSupportedModes,
};
