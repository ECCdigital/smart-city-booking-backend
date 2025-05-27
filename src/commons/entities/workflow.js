class Workflow {
  constructor({
    id,
    tenantId,
    name,
    description,
    states,
    archive,
    defaultState,
    active,
  }) {
    this.id = id;
    this.name = name || "";
    this.tenantId = tenantId || "";
    this.description = description || "";
    this.states = states || [];
    this.archive = archive || [];
    this.defaultState = defaultState || "";
    this.active = active || false;
  }
}

module.exports = Workflow;
