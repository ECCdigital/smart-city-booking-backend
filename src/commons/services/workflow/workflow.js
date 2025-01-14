class Actions {
  constructor() {
  }

  execute() {
    throw new Error('Not implemented');
  }
}

class EmailAction extends Actions {
  constructor() {
  }
}

class Step {
  constructor(id, name, actions) {
    this.id = id;
    this.name = name;
    this.actions = actions;
  }
}

class Workflow {
  constructor(steps, actions) {
    this.steps = steps;
    this.actions = actions;
  }
}