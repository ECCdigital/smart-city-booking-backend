class Workflow {
  constructor({ id, tenantId, name, description, states, archive, active }) {
    this.id = id;
    this.tenantId = tenantId || "";
    this.name = name || "";
    this.description = description || "";
    this.states = states || [];
    this.archive = archive || [];
    this.active = active || false;
  }

  static schema() {
    return {
      id: { type: String, required: true },
      tenantId: { type: String, required: true },
      name: { type: String, default: "" },
      description: { type: String, default: "" },
      states: { type: Array, default: [] },
      archive: { type: Array, default: [] },
      active: { type: Boolean, default: false },
    };
  }
}

module.exports = Workflow;
