const { expect } = require("chai");

const {
  computeSaltoOtp,
} = require("../src/commons/services/access/clients/salto-ks-otp");

describe("computeSaltoOtp", () => {
  // Expected values computed independently with the md5 CLI over the
  // documented input `UTC "YYYYmmDDHHMMSS" + secret + pin` (door proof
  // 2026-08-25, docs/research/salto-ks-remote-open-door-proof.md).
  it("takes the first 5 hex characters of MD5(timestamp + secret + pin)", () => {
    const otp = computeSaltoOtp(
      "ABCDEFGHIJKLMNOP",
      "1234",
      new Date("2026-08-25T07:25:00Z"),
    );

    expect(otp).to.equal("28a5a");
  });

  it("stamps the whole UTC second, no rounding", () => {
    const otp = computeSaltoOtp(
      "qrstuvwxyz012345",
      "9876",
      new Date("2026-12-31T23:59:59.874Z"),
    );

    expect(otp).to.equal("018bb");
  });

  it("uses the current time when no date is given", () => {
    const now = new Date();
    const expected = computeSaltoOtp("ABCDEFGHIJKLMNOP", "1234", now);

    // Same whole second unless the test straddles a second boundary; computing
    // both candidates keeps the test deterministic.
    const after = new Date();
    const candidates = [
      expected,
      computeSaltoOtp("ABCDEFGHIJKLMNOP", "1234", after),
    ];

    expect(candidates).to.include(computeSaltoOtp("ABCDEFGHIJKLMNOP", "1234"));
  });
});
