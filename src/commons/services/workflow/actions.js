class Actions {
  constructor() {
  }
}

class EmailAction extends Actions {
  constructor(type, recipient, subject, body) {
    super();
    this.type = type;
    this.recipient = recipient;
    this.subject = subject;
    this.body = body;
  }
}