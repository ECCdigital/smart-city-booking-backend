/**
 * In-memory adapters for the booking lifecycle seam (spec part 2, section
 * 10): every adapter records its calls and fails on demand, the store keeps
 * a write log and answers the conditional write the way the database does.
 * Modelled on `.scratch/architecture/booking-lifecycle/prototype/in-memory-adapters.js`.
 *
 * A test builds its own lifecycle instance over these:
 *
 *   const adapters = inMemoryAdapters({ bookings: [booking], failOn: { access: ["provision"] } });
 *   const lifecycle = createBookingLifecycle(adapters);
 */

const { ConflictError } = require("../../src/errors/BaseError");
const { Booking } = require("../../src/commons/entities/booking/booking");
const {
  GroupBooking,
} = require("../../src/commons/entities/groupBooking/groupBooking");
const {
  SKIPPED,
} = require("../../src/commons/services/booking-lifecycle/pipeline");

const DOCUMENT_ID_FIELD = {
  receipt: "receiptId",
  invoice: "invoiceId",
  cancellation: "cancellationId",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * An adapter of async methods that records every call, throws for the
 * operations named in `failOn` and answers `SKIPPED` for those named in
 * `skipOn` (a tenant without a payment service, say).
 *
 * @param {string} name The adapter's name, for the error message
 * @param {string[]} ops The method names to expose
 * @param {{ failOn?: string[], skipOn?: string[], returns?: Object<string, Function> }} [options]
 */
function recordingAdapter(
  name,
  ops,
  { failOn = [], skipOn = [], returns = {} } = {},
) {
  const adapter = {
    name,
    calls: [],
    failOn: new Set(failOn),
    skipOn: new Set(skipOn),
  };
  for (const op of ops) {
    adapter[op] = async (...args) => {
      adapter.calls.push({ op, args });
      if (adapter.failOn.has(op)) {
        throw new Error(`${name}.${op} failed (simulated)`);
      }
      if (adapter.skipOn.has(op)) {
        return SKIPPED;
      }
      return returns[op] ? returns[op](...args) : undefined;
    };
  }
  return adapter;
}

/** The tenant the seam answers unless a test hands one in: no refund tiers. */
const DEFAULT_TENANT = Object.freeze({
  id: "tenant-1",
  cancellationRefundTiers: [],
});

/**
 * The booking store: rows keyed by id, handed out as `Booking` entities.
 * `save` is the conditional write of the spec (section 5): it only writes
 * where the stored state is `expectStatus` and answers the previous row;
 * otherwise it throws `ConflictError invalid_transition`. `restore` puts a
 * previous row back, `remove` takes a row out. `failOn` takes `save` or `save <bookingId>`. The
 * recorded `save` call names the fields a write removes where it does.
 * `groups` are the group bookings the seam knows, by id, handed out as
 * `GroupBooking` entities without their members.
 */
function inMemoryStore(seed = [], tenant = DEFAULT_TENANT, groups = []) {
  const rows = new Map(seed.map((booking) => [booking.id, clone(booking)]));
  const groupRows = new Map(groups.map((group) => [group.id, clone(group)]));
  const store = {
    name: "store",
    rows,
    groups: groupRows,
    writes: [],
    calls: [],
    failOn: new Set(),
    async get(tenantId, id) {
      const row = rows.get(id);
      return row && row.tenantId === tenantId ? new Booking(clone(row)) : null;
    },
    async getTenant(tenantId) {
      return tenant && tenant.id === tenantId ? clone(tenant) : null;
    },
    async getGroup(tenantId, groupBookingId) {
      const row = groupRows.get(groupBookingId);
      return row && row.tenantId === tenantId
        ? new GroupBooking(clone(row))
        : null;
    },
    async getMany(tenantId, ids) {
      return ids
        .map((id) => rows.get(id))
        .filter((row) => row && row.tenantId === tenantId)
        .map((row) => new Booking(clone(row)));
    },
    async save(booking, { expectStatus, transition, unset = [] } = {}) {
      store.calls.push({
        op: "save",
        args:
          unset.length > 0
            ? [booking.id, expectStatus, unset]
            : [booking.id, expectStatus],
      });
      if (store.failOn.has("save") || store.failOn.has(`save ${booking.id}`)) {
        throw new Error("store.save failed (simulated)");
      }
      const row = rows.get(booking.id);
      if (!row || row.status !== expectStatus) {
        throw new ConflictError("invalid_transition", {
          bookingId: booking.id,
          status: row?.status,
          transition,
        });
      }
      const previous = clone(row);
      const next = clone(booking);
      for (const field of unset) {
        delete next[field];
      }
      rows.set(booking.id, next);
      store.writes.push({ id: booking.id, status: booking.status });
      return previous;
    },
    async remove(tenantId, id) {
      store.calls.push({ op: "remove", args: [tenantId, id] });
      rows.delete(id);
    },
    async restore(previous) {
      store.calls.push({ op: "restore", args: [previous.id] });
      rows.set(previous.id, clone(previous));
      store.writes.push({
        id: previous.id,
        status: previous.status,
        restored: true,
      });
    },
    /** The `$push` of an issued document, as the issuance does it. */
    attach(id, attachment) {
      const row = rows.get(id);
      row.attachments = [...(row.attachments || []), clone(attachment)];
    },
  };
  return store;
}

function inMemoryAccess(options) {
  return recordingAdapter(
    "access",
    ["hold", "provision", "update", "revoke", "refreshHolds"],
    {
      ...options,
      returns: {
        hold: () => [],
        provision: () => [],
        update: () => [],
        revoke: () => [],
        refreshHolds: () => [],
      },
    },
  );
}

/**
 * The issuance at the seam: numbers `receipt-1`, `receipt-2`, ... per type,
 * a second issue of a type at a booking a revision under the same number;
 * the attachment goes to the store rows and to the entities handed in.
 */
function inMemoryDocuments(store, options = {}) {
  const counters = {};
  const adapter = recordingAdapter("documents", ["issue", "remove"], options);
  const issue = adapter.issue;
  adapter.issue = async (params) => {
    await issue(params);
    const { bookingIds, type, bookings = [] } = params;
    const idField = DOCUMENT_ID_FIELD[type];
    const existing = bookingIds
      .flatMap((id) => store.rows.get(id)?.attachments || [])
      .filter((att) => att.type === type);
    const number =
      existing[0]?.[idField] ||
      `${type}-${(counters[type] = (counters[type] || 0) + 1)}`;
    const revision =
      existing.reduce((max, att) => Math.max(max, att.revision || 1), 0) + 1;
    const name = `${number}${revision > 1 ? `-r${revision}` : ""}.pdf`;
    const attachment = {
      type,
      name,
      title: name,
      [idField]: number,
      revision,
      timeCreated: Date.now(),
    };
    for (const id of bookingIds) {
      store.attach(id, attachment);
    }
    for (const booking of bookings) {
      booking.attachments = [...(booking.attachments || []), { ...attachment }];
    }
    return { attachment, file: { name, buffer: Buffer.from(`%PDF-${name}`) } };
  };
  return adapter;
}

/**
 * The mail adapter at the seam: `send(type, ctx)` records
 * `{ op: "send", args: [type, ctx] }`; `failOn` and `skipOn` name notice
 * types (`BOOKING_CONFIRMATION`), a skipped one being a notice nobody gets.
 */
function inMemoryMail({ failOn = [], skipOn = [] } = {}) {
  const adapter = {
    name: "mail",
    calls: [],
    failOn: new Set(failOn),
    skipOn: new Set(skipOn),
    async send(type, ctx) {
      adapter.calls.push({ op: "send", args: [type, ctx] });
      if (adapter.failOn.has(type)) {
        throw new Error(`mail.${type} failed (simulated)`);
      }
      if (adapter.skipOn.has(type)) {
        return SKIPPED;
      }
      return [];
    },
  };
  return adapter;
}

function inMemoryWorkflow(options) {
  return recordingAdapter("workflow", ["emit"], options);
}

/**
 * The payment adapter at the seam: `requestPayment` answers what the
 * provider answers - `paymentRequest`, the value of the payment request
 * (`{ form: "link" | "invoice" | "pending", paymentUrl?, files? }`), or
 * nothing where a test does not care what the provider says.
 */
function inMemoryPayment({ failOn, skipOn, paymentRequest } = {}) {
  return recordingAdapter("payment", ["requestPayment"], {
    failOn,
    skipOn,
    returns:
      paymentRequest === undefined
        ? {}
        : { requestPayment: () => paymentRequest },
  });
}

/**
 * Every adapter at once, the way a test injects them at the one seam.
 *
 * @param {{ bookings?: Object[], groups?: Object[], tenant?: Object, failOn?: Object<string, string[]>, skipOn?: Object<string, string[]>, paymentRequest?: Object, clock?: () => number }} [options]
 */
function inMemoryAdapters({
  bookings = [],
  groups = [],
  tenant = DEFAULT_TENANT,
  failOn = {},
  skipOn = {},
  paymentRequest,
  clock,
} = {}) {
  const store = inMemoryStore(bookings, tenant, groups);
  for (const op of failOn.store || []) {
    store.failOn.add(op);
  }
  return {
    store,
    access: inMemoryAccess({ failOn: failOn.access }),
    documents: inMemoryDocuments(store, { failOn: failOn.documents }),
    payment: inMemoryPayment({
      failOn: failOn.payment,
      skipOn: skipOn.payment,
      paymentRequest,
    }),
    mail: inMemoryMail({ failOn: failOn.mail, skipOn: skipOn.mail }),
    workflow: inMemoryWorkflow({ failOn: failOn.workflow }),
    clock: clock || (() => 1_756_800_000_000),
  };
}

/**
 * The effect rows of an outcome as `phase adapter.op status` strings; the
 * row of one member of a group names it: `phase adapter.op bookingId status`.
 */
function effectTable(outcome) {
  return outcome.effects.map((effect) =>
    [
      effect.phase,
      `${effect.adapter}.${effect.op}`,
      ...(effect.bookingId ? [effect.bookingId] : []),
      effect.status,
    ].join(" "),
  );
}

module.exports = {
  inMemoryAdapters,
  inMemoryStore,
  DEFAULT_TENANT,
  recordingAdapter,
  effectTable,
  clone,
};
