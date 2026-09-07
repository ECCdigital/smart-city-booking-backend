/**
 * The city filter of the iFBS location list: `IFBS_CITY_IDS` names the
 * cities `getLocations()` answers, read at the call; unset or empty lists
 * every city the iFBS server knows. Before, the list was pinned to CityID 35.
 */

const { expect } = require("chai");
const IfbsApiClient = require("../src/commons/services/access/clients/ifbs-api-client");
const { FakeIfbsApiClient } = require("./helpers/fake-ifbs-api-client");

const cityIdsOf = (cities) => cities.map((city) => city.CityID);
const locationIdsOf = (cities) =>
  cities.flatMap((city) => city.locations.map((loc) => loc.LocationID));

describe("iFBS city filter: IFBS_CITY_IDS on getLocations()", () => {
  const cityIdsBefore = process.env.IFBS_CITY_IDS;
  let client;

  beforeEach(() => {
    delete process.env.IFBS_CITY_IDS;
    client = new FakeIfbsApiClient({
      locations: [
        { LocationID: "1001", Name: "Bahnhof", boxes: ["1"] },
        { LocationID: "1002", Name: "Rathaus", CityID: "36", boxes: ["2"] },
      ],
    });
  });

  afterEach(() => {
    if (cityIdsBefore === undefined) {
      delete process.env.IFBS_CITY_IDS;
    } else {
      process.env.IFBS_CITY_IDS = cityIdsBefore;
    }
  });

  it("lists every city when the env is not set", async () => {
    const cities = await client.getLocations();

    expect(cityIdsOf(cities)).to.deep.equal(["35", "36"]);
    expect(locationIdsOf(cities)).to.deep.equal(["1001", "1002"]);
  });

  it("lists every city when the env is empty", async () => {
    process.env.IFBS_CITY_IDS = "";

    const cities = await client.getLocations();

    expect(cityIdsOf(cities)).to.deep.equal(["35", "36"]);
  });

  it("lists only the named city", async () => {
    process.env.IFBS_CITY_IDS = "35";

    const cities = await client.getLocations();

    expect(cityIdsOf(cities)).to.deep.equal(["35"]);
    expect(locationIdsOf(cities)).to.deep.equal(["1001"]);
  });

  it("lists the named cities, whitespace around each entry ignored", async () => {
    process.env.IFBS_CITY_IDS = " 35 , 36 ";

    const cities = await client.getLocations();

    expect(cityIdsOf(cities)).to.deep.equal(["35", "36"]);
  });

  it("answers no city when none of the named ones is known", async () => {
    process.env.IFBS_CITY_IDS = "99";

    const cities = await client.getLocations();

    expect(cities).to.deep.equal([]);
  });

  it("compares the CityID as a string, whatever type the answer carries", async () => {
    process.env.IFBS_CITY_IDS = "36";
    client.locations.get("1002").CityID = 36;

    const cities = await client.getLocations();

    expect(locationIdsOf(cities)).to.deep.equal(["1002"]);
  });

  it("reads the env at the call, not when the client is built", async () => {
    const built = new FakeIfbsApiClient({
      locations: [
        { LocationID: "1001", boxes: [] },
        { LocationID: "1002", CityID: "36", boxes: [] },
      ],
    });
    process.env.IFBS_CITY_IDS = "36";

    const cities = await built.getLocations();

    expect(cityIdsOf(cities)).to.deep.equal(["36"]);
  });

  describe("cityIdsFromEnv: the parser of the comma list", () => {
    it("answers no restriction for an unset or empty env", () => {
      expect(IfbsApiClient.cityIdsFromEnv(undefined)).to.deep.equal([]);
      expect(IfbsApiClient.cityIdsFromEnv("")).to.deep.equal([]);
      expect(IfbsApiClient.cityIdsFromEnv("   ")).to.deep.equal([]);
    });

    it("trims every entry and drops the empty ones", () => {
      expect(IfbsApiClient.cityIdsFromEnv(" 35 , ,36,, ")).to.deep.equal([
        "35",
        "36",
      ]);
    });

    it("keeps a single entry as it is", () => {
      expect(IfbsApiClient.cityIdsFromEnv("35")).to.deep.equal(["35"]);
    });
  });
});
