/**
 * The check before the deploy of v4.3.1 (ECCdigital/tickets#283): finds the
 * accounts whose addresses differ only in case or in blanks around them.
 *
 * From v4.3.1 on sign-in, signup and forgot password find an account by its
 * address trimmed and without regard to case (ECCdigital/tickets#259). Of two
 * such accounts only one is found then - the one stored trimmed and in lower
 * case, if there is one - and the person behind the other is locked out. The
 * check lists every such account with its bookings and roles, so the operator
 * can decide before the deploy (docs/migrations/v4.3.1-upgrade.md).
 *
 * It only reads. It runs against the database the backend uses (`DB_URL`,
 * `DB_NAME`, also from the repository's `.env`), on v4.3.0 as on v4.3.1:
 *
 *   node scripts/find-case-duplicate-accounts.js [--dbname <name>]
 *
 * Exit code 0: no finding, 2: findings, 1: the check failed.
 */

const path = require("node:path");

const { normalizeUserId } = require("../src/commons/utilities/user-id-utils");

const FOUND_YES = "yes";
const FOUND_NO = "no";
const FOUND_UNDETERMINED = "undetermined";

/**
 * The roles a membership gives, as the report names them.
 *
 * @param {Object} membership
 * @returns {string[]}
 */
function rolesOfMembership(membership) {
  const status =
    membership.status && membership.status !== "active"
      ? ` (${membership.status})`
      : "";
  const roles = [];
  if (membership.owner) {
    roles.push(`owner of tenant ${membership.tenantId}${status}`);
  }
  if (Array.isArray(membership.roles) && membership.roles.length > 0) {
    roles.push(
      `roles ${membership.roles.join(", ")} in tenant ${membership.tenantId}${status}`,
    );
  }
  return roles;
}

/**
 * Which account a lookup of the address finds from v4.3.1 on: the one whose
 * stored id is the address itself; with none or several of those, whichever
 * the database returns first.
 *
 * @param {Object[]} accounts - The accounts of one address.
 * @param {string} address - The normalized address.
 * @returns {string[]} One of `yes`, `no`, `undetermined` per account.
 */
function foundFromV431(accounts, address) {
  const exact = accounts.filter((account) => account.id === address).length;
  return accounts.map((account) => {
    if (exact === 0) return FOUND_UNDETERMINED;
    if (account.id !== address) return FOUND_NO;
    return exact === 1 ? FOUND_YES : FOUND_UNDETERMINED;
  });
}

/**
 * Finds the accounts whose addresses differ only in case or in blanks around
 * them, with the bookings assigned to each and the roles it holds. Bookings
 * and roles count for the account whose stored id they name exactly; those
 * naming the address in a spelling no account of it has are reported for the
 * address. Reads only.
 *
 * @param {Object} models - `UserModel`, `BookingModel`, `MembershipModel`, `InstanceModel`.
 * @returns {Promise<Object[]>} One entry per address: `{ address, accounts, otherSpellings }`.
 */
async function findCaseDuplicateAccounts({
  UserModel,
  BookingModel,
  MembershipModel,
  InstanceModel,
}) {
  const users = await UserModel.find(
    {},
    { _id: 1, id: 1, created: 1, authType: 1, isVerified: 1 },
  ).lean();

  const accountsByAddress = new Map();
  for (const user of users) {
    const address = normalizeUserId(user.id);
    if (!address) continue;
    if (!accountsByAddress.has(address)) accountsByAddress.set(address, []);
    accountsByAddress.get(address).push(user);
  }

  const groups = new Map(
    [...accountsByAddress]
      .filter(([, accounts]) => accounts.length > 1)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([address, accounts]) => {
        const found = foundFromV431(accounts, address);
        return [
          address,
          {
            address,
            accounts: accounts.map((user, index) => ({
              _id: String(user._id),
              id: user.id,
              created: user.created,
              authType: user.authType || "local",
              isVerified: user.isVerified === true,
              foundFromV431: found[index],
              bookings: 0,
              roles: [],
            })),
            otherSpellings: { bookings: 0, roles: [] },
          },
        ];
      }),
  );

  if (groups.size === 0) {
    return [];
  }

  /** Who a reference names: an account of a group, the group itself, or none. */
  function holderOf(userId) {
    const group = groups.get(normalizeUserId(userId));
    if (!group) return null;
    return (
      group.accounts.find((account) => account.id === userId) ??
      group.otherSpellings
    );
  }

  const spelling = (holder, userId) =>
    holder.id === undefined ? ` (as ${JSON.stringify(userId)})` : "";

  const instances = await InstanceModel.find({}, { ownerUserIds: 1 }).lean();
  for (const instance of instances) {
    for (const ownerId of instance.ownerUserIds ?? []) {
      const holder = holderOf(ownerId);
      if (holder)
        holder.roles.push(`instance owner${spelling(holder, ownerId)}`);
    }
  }

  const memberships = await MembershipModel.find(
    {},
    { userId: 1, tenantId: 1, roles: 1, owner: 1, status: 1 },
  ).lean();
  for (const membership of memberships) {
    const holder = holderOf(membership.userId);
    if (!holder) continue;
    for (const role of rolesOfMembership(membership)) {
      holder.roles.push(`${role}${spelling(holder, membership.userId)}`);
    }
  }

  const bookings = await BookingModel.find(
    { assignedUserId: { $type: "string", $ne: "" } },
    { _id: 0, assignedUserId: 1 },
  ).lean();
  for (const booking of bookings) {
    const holder = holderOf(booking.assignedUserId);
    if (holder) holder.bookings += 1;
  }

  return [...groups.values()];
}

function describeRoles(roles) {
  return roles.length > 0 ? roles.join(", ") : "none";
}

function formatDate(created) {
  const time = Number(created);
  return Number.isFinite(time) && created != null
    ? new Date(time).toISOString().slice(0, 10)
    : "unknown";
}

/**
 * The findings as an operator reads them, and as they go into the ticket.
 *
 * @param {Object[]} groups - The answer of `findCaseDuplicateAccounts`.
 * @returns {string}
 */
function formatReport(groups) {
  if (groups.length === 0) {
    return "No accounts whose addresses differ only in case or in blanks around them.";
  }

  const accountCount = groups.reduce(
    (sum, group) => sum + group.accounts.length,
    0,
  );
  const lines = [
    `Accounts whose addresses differ only in case or in blanks around them: ${groups.length} ${groups.length === 1 ? "address" : "addresses"}, ${accountCount} accounts.`,
  ];

  for (const group of groups) {
    lines.push("", group.address);
    for (const account of group.accounts) {
      lines.push(
        `  - ${JSON.stringify(account.id)} (_id ${account._id}, created ${formatDate(account.created)}, ${account.authType}, ${account.isVerified ? "verified" : "unverified"}): found from v4.3.1 on: ${account.foundFromV431}; bookings: ${account.bookings}; roles: ${describeRoles(account.roles)}`,
      );
    }
    const other = group.otherSpellings;
    if (other.bookings > 0 || other.roles.length > 0) {
      lines.push(
        `  - in another spelling: bookings: ${other.bookings}; roles: ${describeRoles(other.roles)}`,
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  // Anchored at the repository like the CLIs under src/cli; variables set in
  // the environment win over the file.
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

  const yargs = require("yargs/yargs");
  const { hideBin } = require("yargs/helpers");
  const argv = yargs(hideBin(process.argv))
    .scriptName("find-case-duplicate-accounts")
    .usage(
      "$0 [options]\n\nLists accounts whose addresses differ only in case or in blanks around them. Reads only.",
    )
    .option("dbname", {
      type: "string",
      describe: "Database to check, defaults to DB_NAME",
    })
    .strict()
    .parse();

  const dbm = require("../src/commons/utilities/database-manager");
  const models = {
    UserModel: require("../src/commons/data-managers/models/userModel"),
    BookingModel: require("../src/commons/data-managers/models/bookingModel"),
    MembershipModel: require("../src/commons/data-managers/models/membershipModel"),
    InstanceModel: require("../src/commons/data-managers/models/instanceModel"),
  };

  await dbm.getInstance().connect(argv.dbname || process.env.DB_NAME);
  try {
    const groups = await findCaseDuplicateAccounts(models);
    console.log(formatReport(groups));
    process.exitCode = groups.length > 0 ? 2 : 0;
  } finally {
    await dbm.getInstance().close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`The check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { findCaseDuplicateAccounts, formatReport };
