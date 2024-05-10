class Parser {
  static parseBoolean(string) {
    return string === "true" ? true : string === "false" ? false : undefined;
  }
}

module.exports = Parser;
