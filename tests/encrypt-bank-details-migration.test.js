process.env.CRYPTO_SECRET =
  process.env.CRYPTO_SECRET || "0123456789abcdef0123456789abcdef";

const { expect } = require("chai");

const migration = require("../migrations/scripts/14-10-2026-encrypt-bank-details");
const SecurityUtils = require("../src/commons/utilities/security-utils");
const { decryptBankDetails } = require("../src/commons/utilities/bank-details");

const BANK_DETAILS = {
  accountHolder: "Erika Muster",
  bankName: "Sparkasse",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
};
const ACCOUNT = {
  bank: "Volksbank",
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  accountHolder: "Stadt Musterhausen",
};

/** A collection over plain documents: every document found, `$set` by path. */
function fakeCollection(docs) {
  const updates = [];
  return {
    docs,
    updates,
    find: () => docs,
    async updateOne({ _id }, { $set }) {
      updates.push($set);
      const doc = docs.find((d) => d._id === _id);
      for (const [path, value] of Object.entries($set)) {
        const keys = path.split(".");
        const last = keys.pop();
        keys.reduce((node, key) => node[key], doc)[last] = value;
      }
    },
  };
}

function world() {
  const bookings = fakeCollection([
    {
      _id: "b1",
      hooks: [
        { id: "h0", type: "REJECT", payload: { reason: "" } },
        {
          id: "h1",
          type: "REJECT",
          payload: { reason: "Krank", bankDetails: { ...BANK_DETAILS } },
        },
      ],
    },
  ]);
  const tenants = fakeCollection([
    {
      _id: "t1",
      applications: [
        { type: "payment", id: "giroCockpit", paymentSecret: "keep" },
        {
          type: "payment",
          id: "invoice",
          active: true,
          ...ACCOUNT,
          daysUntilPaymentDue: 14,
        },
      ],
    },
  ]);
  const mongoose = {
    model: (name) => ({
      collection: { Booking: bookings, Tenant: tenants }[name],
    }),
  };
  return { mongoose, bookings, tenants };
}

describe("14-10-2026-encrypt-bank-details migration", function () {
  const secret = process.env.CRYPTO_SECRET;

  afterEach(function () {
    process.env.CRYPTO_SECRET = secret;
  });

  it("encrypts the bank details of a cancellation request", async function () {
    const { mongoose, bookings } = world();

    await migration.up(mongoose);

    const stored = bookings.docs[0].hooks[1].payload;
    for (const field of Object.keys(BANK_DETAILS)) {
      expect(SecurityUtils.isEncrypted(stored.bankDetails[field])).to.equal(
        true,
      );
    }
    expect(stored.reason).to.equal("Krank");
    expect(decryptBankDetails(stored.bankDetails)).to.deep.equal(BANK_DETAILS);
    expect(bookings.docs[0].hooks[0].payload).to.deep.equal({ reason: "" });
  });

  it("encrypts the tenant's bank account in the invoice application, nothing else", async function () {
    const { mongoose, tenants } = world();

    await migration.up(mongoose);

    const [giro, invoice] = tenants.docs[0].applications;
    expect(giro.paymentSecret).to.equal("keep");
    for (const field of Object.keys(ACCOUNT)) {
      expect(SecurityUtils.isEncrypted(invoice[field]), field).to.equal(true);
      expect(SecurityUtils.decrypt(invoice[field])).to.equal(ACCOUNT[field]);
    }
    expect(invoice.daysUntilPaymentDue).to.equal(14);
    expect(JSON.stringify(tenants.docs)).not.to.contain(ACCOUNT.iban);
  });

  it("can run again: a value already encrypted is not written", async function () {
    const { mongoose, bookings, tenants } = world();
    await migration.up(mongoose);
    const once = JSON.stringify([bookings.docs, tenants.docs]);
    bookings.updates.length = 0;
    tenants.updates.length = 0;

    await migration.up(mongoose);

    expect(bookings.updates).to.deep.equal([]);
    expect(tenants.updates).to.deep.equal([]);
    expect(JSON.stringify([bookings.docs, tenants.docs])).to.equal(once);
  });

  it("leaves empty fields empty", async function () {
    const { mongoose, tenants } = world();
    Object.assign(tenants.docs[0].applications[1], { bank: "", bic: "" });

    await migration.up(mongoose);

    expect(tenants.docs[0].applications[1]).to.include({ bank: "", bic: "" });
  });

  it("fails without CRYPTO_SECRET and writes nothing", async function () {
    const { mongoose, bookings, tenants } = world();
    delete process.env.CRYPTO_SECRET;

    let error;
    try {
      await migration.up(mongoose);
    } catch (err) {
      error = err;
    }

    expect(error?.message).to.match(/CRYPTO_SECRET/);
    expect(bookings.updates).to.deep.equal([]);
    expect(tenants.updates).to.deep.equal([]);
  });

  it("leaves the documents alone on down", async function () {
    const { mongoose, bookings, tenants } = world();
    await migration.up(mongoose);
    bookings.updates.length = 0;
    tenants.updates.length = 0;

    await migration.down(mongoose);

    expect(bookings.updates).to.deep.equal([]);
    expect(tenants.updates).to.deep.equal([]);
  });
});
