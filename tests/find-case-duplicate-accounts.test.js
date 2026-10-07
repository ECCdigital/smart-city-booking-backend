/**
 * The check before the deploy of v4.3.1 (ECCdigital/tickets#283): from v4.3.1
 * on an account is found by its address trimmed and without regard to case
 * (ECCdigital/tickets#259), so of two accounts that differ only so one is no
 * longer found. The check names them, with their bookings and roles, and
 * changes nothing: the models it gets can only read.
 */

const { expect } = require("chai");

const {
  findCaseDuplicateAccounts,
  formatReport,
} = require("../scripts/find-case-duplicate-accounts");

/** A model that can only read: `find(...).lean()` answers the rows. */
function readOnlyModel(rows) {
  return {
    find: () => ({ lean: async () => rows.map((row) => ({ ...row })) }),
  };
}

function models({
  users = [],
  bookings = [],
  memberships = [],
  instances = [{ ownerUserIds: [] }],
} = {}) {
  return {
    UserModel: readOnlyModel(users),
    BookingModel: readOnlyModel(bookings),
    MembershipModel: readOnlyModel(memberships),
    InstanceModel: readOnlyModel(instances),
  };
}

let nextObjectId = 1;
function account(id, fields = {}) {
  return {
    _id: `oid-${nextObjectId++}`,
    id,
    created: Date.UTC(2025, 2, 1),
    authType: "local",
    isVerified: true,
    ...fields,
  };
}

function booking(assignedUserId) {
  return { assignedUserId };
}

function membership(userId, tenantId, fields = {}) {
  return {
    userId,
    tenantId,
    roles: [],
    owner: false,
    status: "active",
    ...fields,
  };
}

describe("find-case-duplicate-accounts (ECCdigital/tickets#283)", function () {
  it("finds two accounts whose addresses differ only in case", async function () {
    const groups = await findCaseDuplicateAccounts(
      models({
        users: [
          account("Erika@Example.org"),
          account("erika@example.org"),
          account("max@example.org"),
        ],
      }),
    );

    expect(groups).to.have.length(1);
    expect(groups[0].address).to.equal("erika@example.org");
    expect(groups[0].accounts.map((a) => a.id)).to.have.members([
      "Erika@Example.org",
      "erika@example.org",
    ]);
  });

  it("finds accounts whose addresses differ only in blanks around them", async function () {
    const groups = await findCaseDuplicateAccounts(
      models({
        users: [account(" max@example.org "), account("max@example.org")],
      }),
    );

    expect(groups).to.have.length(1);
    expect(groups[0].address).to.equal("max@example.org");
    expect(groups[0].accounts).to.have.length(2);
  });

  it("finds nothing when every address stands for one account", async function () {
    const groups = await findCaseDuplicateAccounts(
      models({
        users: [
          account("erika@example.org"),
          account("erika@example.org.de"),
          account("e.rika@example.org"),
          account(""),
          account("  "),
        ],
      }),
    );

    expect(groups).to.deep.equal([]);
  });

  it("names the account v4.3.1 finds: the one stored trimmed and in lower case", async function () {
    const [group] = await findCaseDuplicateAccounts(
      models({
        users: [account("ERIKA@example.org"), account("erika@example.org")],
      }),
    );

    const foundBy = Object.fromEntries(
      group.accounts.map((a) => [a.id, a.foundFromV431]),
    );
    expect(foundBy).to.deep.equal({
      "ERIKA@example.org": "no",
      "erika@example.org": "yes",
    });
  });

  it("leaves it open which account v4.3.1 finds when none is stored in lower case", async function () {
    const [group] = await findCaseDuplicateAccounts(
      models({
        users: [account("ERIKA@example.org"), account("Erika@example.org")],
      }),
    );

    expect(group.accounts.map((a) => a.foundFromV431)).to.deep.equal([
      "undetermined",
      "undetermined",
    ]);
  });

  it("counts the bookings assigned to each account by its exact address", async function () {
    const [group] = await findCaseDuplicateAccounts(
      models({
        users: [account("Erika@example.org"), account("erika@example.org")],
        bookings: [
          booking("erika@example.org"),
          booking("erika@example.org"),
          booking("Erika@example.org"),
          booking("max@example.org"),
          booking(""),
          booking(null),
        ],
      }),
    );

    const bookingsOf = Object.fromEntries(
      group.accounts.map((a) => [a.id, a.bookings]),
    );
    expect(bookingsOf).to.deep.equal({
      "Erika@example.org": 1,
      "erika@example.org": 2,
    });
  });

  it("names the roles of each account: instance owner, tenant owner, roles of a membership", async function () {
    const [group] = await findCaseDuplicateAccounts(
      models({
        users: [account("Erika@example.org"), account("erika@example.org")],
        memberships: [
          membership("erika@example.org", "t1", { owner: true }),
          membership("erika@example.org", "t2", {
            roles: ["r1", "r2"],
            status: "pending",
          }),
          membership("erika@example.org", "t3"),
          membership("max@example.org", "t1", { owner: true }),
        ],
        instances: [{ ownerUserIds: ["Erika@example.org"] }],
      }),
    );

    const rolesOf = Object.fromEntries(
      group.accounts.map((a) => [a.id, a.roles]),
    );
    expect(rolesOf).to.deep.equal({
      "Erika@example.org": ["instance owner"],
      "erika@example.org": [
        "owner of tenant t1",
        "roles r1, r2 in tenant t2 (pending)",
      ],
    });
  });

  it("reports bookings and roles in a spelling no account of the address has", async function () {
    const [group] = await findCaseDuplicateAccounts(
      models({
        users: [account("ERIKA@example.org"), account("Erika@example.org")],
        bookings: [booking("erika@example.org"), booking(" erika@example.org")],
        memberships: [membership("erika@example.org", "t1", { owner: true })],
      }),
    );

    expect(group.accounts.map((a) => a.bookings)).to.deep.equal([0, 0]);
    expect(group.accounts.map((a) => a.roles)).to.deep.equal([[], []]);
    expect(group.otherSpellings).to.deep.equal({
      bookings: 2,
      roles: ['owner of tenant t1 (as "erika@example.org")'],
    });
  });

  describe("the report", function () {
    it("says so when there is no finding", function () {
      expect(formatReport([])).to.equal(
        "No accounts whose addresses differ only in case or in blanks around them.",
      );
    });

    it("lists every account of an address with what decides its fate", async function () {
      const groups = await findCaseDuplicateAccounts(
        models({
          users: [
            account("Erika@example.org", {
              _id: "64f000000000000000000001",
              created: Date.UTC(2024, 4, 2),
              isVerified: false,
            }),
            account("erika@example.org", {
              _id: "64f000000000000000000002",
              created: Date.UTC(2025, 0, 15),
              authType: "keycloak",
            }),
          ],
          bookings: [booking("erika@example.org")],
          memberships: [membership("erika@example.org", "t1", { owner: true })],
        }),
      );

      expect(formatReport(groups)).to.equal(
        [
          "Accounts whose addresses differ only in case or in blanks around them: 1 address, 2 accounts.",
          "",
          "erika@example.org",
          '  - "Erika@example.org" (_id 64f000000000000000000001, created 2024-05-02, local, unverified): found from v4.3.1 on: no; bookings: 0; roles: none',
          '  - "erika@example.org" (_id 64f000000000000000000002, created 2025-01-15, keycloak, verified): found from v4.3.1 on: yes; bookings: 1; roles: owner of tenant t1',
        ].join("\n"),
      );
    });

    it("adds the references in another spelling when there are any", async function () {
      const groups = await findCaseDuplicateAccounts(
        models({
          users: [
            account("ERIKA@example.org", { _id: "a" }),
            account("Erika@example.org", { _id: "b" }),
          ],
          bookings: [booking("erika@example.org")],
        }),
      );

      expect(formatReport(groups).split("\n").slice(-1)[0]).to.equal(
        "  - in another spelling: bookings: 1; roles: none",
      );
    });
  });
});
