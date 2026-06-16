const { expect } = require("chai");
const { transformPlaceholders } = require("../src/rule-engine/utils");

describe("transformPlaceholders", () => {
  const now = new Date("2026-06-16T12:00:00.000Z");

  it("replaces $$NOW with the current date", () => {
    const result = transformPlaceholders({ timeCreated: "$$NOW" }, now);
    expect(result.timeCreated).to.equal(now);
  });

  it("resolves $$DATE_SUBTRACT to epoch millis (now - 14 days)", () => {
    const result = transformPlaceholders(
      {
        timeCreated: { $lt: { $$DATE_SUBTRACT: { unit: "day", amount: 14 } } },
      },
      now,
    );

    const expected = now.getTime() - 14 * 24 * 60 * 60 * 1000;
    expect(result.timeCreated.$lt).to.equal(expected);
  });

  it("resolves $$DATE_ADD to epoch millis (now + 7 days)", () => {
    const result = transformPlaceholders(
      { timeBegin: { $gte: { $$DATE_ADD: { unit: "day", amount: 7 } } } },
      now,
    );

    const expected = now.getTime() + 7 * 24 * 60 * 60 * 1000;
    expect(result.timeBegin.$gte).to.equal(expected);
  });

  it("supports hour units", () => {
    const result = transformPlaceholders(
      { $$DATE_SUBTRACT: { unit: "hour", amount: 48 } },
      now,
    );
    expect(result).to.equal(now.getTime() - 48 * 60 * 60 * 1000);
  });

  it("can return a Date when as=date is set", () => {
    const result = transformPlaceholders(
      { $$DATE_SUBTRACT: { unit: "day", amount: 1, as: "date" } },
      now,
    );
    expect(result).to.be.instanceOf(Date);
    expect(result.getTime()).to.equal(now.getTime() - 24 * 60 * 60 * 1000);
  });

  it("handles calendar months", () => {
    const result = transformPlaceholders(
      { $$DATE_SUBTRACT: { unit: "month", amount: 1, as: "date" } },
      now,
    );
    expect(result.getMonth()).to.equal(4); // May (0-indexed)
  });

  it("throws on an unsupported unit", () => {
    expect(() =>
      transformPlaceholders(
        { $$DATE_SUBTRACT: { unit: "fortnight", amount: 1 } },
        now,
      ),
    ).to.throw();
  });

  it("throws when amount is missing", () => {
    expect(() =>
      transformPlaceholders({ $$DATE_SUBTRACT: { unit: "day" } }, now),
    ).to.throw();
  });

  it("does not treat multi-key objects as placeholders", () => {
    const result = transformPlaceholders(
      { $$DATE_SUBTRACT: { unit: "day", amount: 1 }, other: "x" },
      now,
    );
    // Two keys → not a placeholder, recurses normally.
    expect(result.other).to.equal("x");
    expect(result.$$DATE_SUBTRACT).to.deep.equal({ unit: "day", amount: 1 });
  });
});
