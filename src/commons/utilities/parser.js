class Parser {
  static toBool(val) {
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0;
    if (typeof val !== "string") return false;

    switch (val.toLowerCase().trim()) {
      case "true":
      case "1":
      case "yes":
        return true;
      default:
        return false;
    }
  }
}

module.exports = Parser;
