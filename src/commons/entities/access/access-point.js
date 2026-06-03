const AccessPointType = Object.freeze({
  LOCKER: "locker",
  DOOR: "door",
});

const AccessPointMode = Object.freeze({
  REMOTE: "remote",
  AUTHORIZATION: "authorization",
  BOTH: "both",
});

const AccessPointState = Object.freeze({
  OPEN: "open",
  CLOSED: "closed",
  UNKNOWN: "unknown",
});

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
  AccessPointType,
  AccessPointMode,
  AccessPointState,
};
