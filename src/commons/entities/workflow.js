class Workflow {
  constructor({ id, tenant, name, description, states, archive, active }) {
    this.id = id;
    this.tenant = tenant || "";
    this.name = name || "";
    this.description = description || "";
    this.states = states || [];
    this.archive = archive || [];
    this.active = active || false
  }
}

module.exports = Workflow;
