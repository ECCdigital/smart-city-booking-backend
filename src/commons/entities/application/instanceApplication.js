class InstanceApplication {
  constructor({ type, id, active = false, title = "" }) {
    this.type = type;
    this.id = id;
    this.active = active;
    this.title = title;
  }

  decrypt() {}

  encrypt() {}

  removePrivateData() {}

  static get Schema() {
    return {
      type: {
        type: String,
        required: true,
        enum: ["auth"],
      },
      id: {
        type: String,
        required: true,
      },
      active: {
        type: Boolean,
        default: false,
      },
      title: {
        type: String,
        default: "",
      },
    };
  }
}

module.exports = InstanceApplication;
