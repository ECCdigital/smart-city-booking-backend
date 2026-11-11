/**
 * Which access point carries its own list of Fächer (tickets#1037): the
 * question the platform's assignment branches on, answered from the
 * access point's data, never from its provider's name.
 */

const { expect } = require("chai");

const {
  carriesOwnCompartments,
  compartmentsOf,
} = require("../src/commons/services/access/locker-system-compartments");

const COMPARTMENT = {
  id: "9b2f6c1e-3d4a-4f5b-8c7d-1e2f3a4b5c6d",
  number: 1,
  lockerBank: { id: "bank-1", name: "Labor Fachbank 1" },
  outOfService: false,
};

describe("locker system compartments", () => {
  describe("carriesOwnCompartments", () => {
    [
      {
        name: "an Open Locker Schließfachanlage with its Fächer",
        accessPoint: {
          type: "locker",
          provider: "open-locker",
          config: { compartments: [COMPARTMENT] },
        },
        carries: true,
      },
      {
        name: "a Schließfachanlage whose list is still empty",
        accessPoint: {
          type: "locker",
          provider: "open-locker",
          config: { compartments: [] },
        },
        carries: true,
      },
      {
        name: "an iFBS Anlage, whose provider assigns the Fach",
        accessPoint: { type: "locker", provider: "ifbs", config: {} },
        carries: false,
      },
      {
        name: "a Pareva Anlage without config",
        accessPoint: { type: "locker", provider: "pareva" },
        carries: false,
      },
      {
        name: "a fixed Open Locker Fach",
        accessPoint: {
          type: "door",
          provider: "open-locker",
          externalId: COMPARTMENT.id,
          config: { compartments: [COMPARTMENT] },
        },
        carries: false,
      },
      { name: "no access point at all", accessPoint: null, carries: false },
    ].forEach(({ name, accessPoint, carries }) => {
      it(`answers ${carries} for ${name}`, () => {
        expect(carriesOwnCompartments(accessPoint)).to.equal(carries);
      });
    });
  });

  describe("compartmentsOf", () => {
    it("answers the Fächer of an Anlage that carries its own list", () => {
      expect(
        compartmentsOf({
          type: "locker",
          config: { compartments: [COMPARTMENT] },
        }),
      ).to.deep.equal([COMPARTMENT]);
    });

    it("answers none for an access point without its own list", () => {
      expect(compartmentsOf({ type: "locker", config: {} })).to.deep.equal([]);
    });
  });
});
