// commons/entities/access/access-point.js

const AccessPointType = Object.freeze({
  LOCKER: "locker",
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
    type, // AccessPointType
    provider, // z.B. "ilockit", "nuki", "salto"
    externalId, // ID beim Provider
    locationId, // optional: Standort
    label, // z.B. "Box 12" oder "Raum 3.04"
    metadata, // provider-spezifische Daten
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

module.exports = { AccessPoint, AccessPointType, AccessPointState };
