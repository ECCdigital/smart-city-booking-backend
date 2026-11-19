const assert = require("assert");
const CsvExportController = require("../src/platform/exporters/controllers/csv-export-controller");

describe("the attendee list as CSV", function () {
  it("keeps a separator inside a value in its column", function () {
    const csv = CsvExportController._toCsv([
      { id: "A", name: "Müller; Sohn", zipCode: "12345" },
    ]);

    assert.strictEqual(csv, 'id;name;zipCode\r\nA;"Müller; Sohn";12345');
  });

  it("doubles a quote inside a value", function () {
    const csv = CsvExportController._toCsv([{ name: 'Gasthof "Zur Post"' }]);

    assert.strictEqual(csv, 'name\r\n"Gasthof ""Zur Post"""');
  });

  it("replaces a CRLF inside a value with a space", function () {
    const csv = CsvExportController._toCsv([{ street: "Hof 1\r\nHinterhaus" }]);

    assert.strictEqual(csv, "street\r\nHof 1 Hinterhaus");
  });

  it("replaces an LF inside a value with a space", function () {
    const csv = CsvExportController._toCsv([{ street: "Hof 1\nHinterhaus" }]);

    assert.strictEqual(csv, "street\r\nHof 1 Hinterhaus");
  });

  it("replaces a CR inside a value with a space", function () {
    const csv = CsvExportController._toCsv([{ street: "Hof 1\rHinterhaus" }]);

    assert.strictEqual(csv, "street\r\nHof 1 Hinterhaus");
  });

  it("keeps numbers, booleans, empty values and spaces", function () {
    const csv = CsvExportController._toCsv([
      { zero: 0, no: false, missing: undefined, empty: null, text: " a " },
    ]);

    assert.strictEqual(csv, "zero;no;missing;empty;text\r\n0;false;;; a ");
  });
});
