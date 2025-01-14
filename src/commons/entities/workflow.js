class Workflow {
  constructor({ id, tenant, name, description, status }) {
    this.id = id;
    this.tenant = tenant || "";
    this.name = name || "";
    this.description = description || "";
    this.status = status || [];
  }
}

class Status {
  constructor({ id, name, actions, tasks }) {
    this.id = id;
    this.name = name || "";
    this.actions = actions || [];
    this.tasks = tasks || [];
  }
}

class Action {
  constructor({ type }) {
    this.type = type;
  }
}

module.exports = Workflow;
