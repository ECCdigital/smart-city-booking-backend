/**
 * The contract every mail transport (glossary "Versandweg") has to keep at
 * the seam `MailerService.send` talks through. One suite, run against
 * every transport - SMTP over nodemailer's `streamTransport`, Microsoft
 * Graph over a fake HTTP client, and the in-memory transport the tests use
 * as the third implementation.
 *
 * Written for the first ticket of the mail-stack chain (Wayfinder,
 * "Mail-Stack (1): Charakterisierung ..."; spec section 3). The cases that
 * run pin the transport as it is today: the choice between the instance's
 * and the tenant's account, the silent fallback, the silent exit when
 * mail is disabled, three attempts and the throw. The cases under
 * `it.skip` are the target form of ticket 2 - `send(mail)` answering
 * `{ status: "sent" | "skipped" }`, the fallback warned once per tenant
 * configuration, the pool hash with the Graph secret in it - and turn
 * green with it.
 */

const assert = require("assert");
const sinon = require("sinon");
const nodemailer = require("nodemailer");

const MailerService = require("../src/commons/mail-service/mail-service");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const { FakeGraphMailClient } = require("./helpers/fake-graph-mail-client");
const {
  installInMemoryMailTransport,
  refusedSends,
} = require("./helpers/in-memory-mail-transport");

const TENANT = "kontrakt";
const TO = "erika@example.test";
const BCC = "kopie@example.test";
const SUBJECT = "Contract test";
const HTML = "<p>Contract test body</p>";
const ATTACHMENT = {
  filename: "RE-1.pdf",
  content: Buffer.from("%PDF-1.4 contract"),
  contentType: "application/pdf",
};

/** The address out of a nodemailer `from` (`Name <address>`). */
function addressOf(from) {
  const match = String(from).match(/<([^>]+)>/);
  return match ? match[1] : String(from);
}

const INSTANCE_SMTP = {
  noreplyMail: "noreply@instanz.example.test",
  noreplyDisplayName: "Instanz",
  noreplyHost: "smtp.instanz.example.test",
  noreplyPort: 465,
  noreplyUser: "instanz",
  noreplyPassword: "instanz-geheim",
  noreplyStarttls: false,
  noreplyUseGraphApi: false,
  noreplyGraphTenantId: "",
  noreplyGraphClientId: "",
  noreplyGraphClientSecret: null,
};

const TENANT_SMTP = {
  useInstanceMail: false,
  noreplyMail: "noreply@mandant.example.test",
  noreplyDisplayName: "Mandant",
  noreplyHost: "smtp.mandant.example.test",
  noreplyPort: 587,
  noreplyUser: "mandant",
  noreplyPassword: "mandant-geheim",
  noreplyStarttls: true,
  noreplyUseGraphApi: false,
};

const INSTANCE_GRAPH = {
  ...INSTANCE_SMTP,
  noreplyHost: "",
  noreplyUseGraphApi: true,
  noreplyGraphTenantId: "instanz-directory",
  noreplyGraphClientId: "instanz-client",
  noreplyGraphClientSecret: "instanz-graph-geheim",
};

const TENANT_GRAPH = {
  useInstanceMail: false,
  noreplyMail: "noreply@mandant.example.test",
  noreplyDisplayName: "Mandant",
  noreplyUseGraphApi: true,
  noreplyGraphTenantId: "mandant-directory",
  noreplyGraphClientId: "mandant-client",
  noreplyGraphClientSecret: "mandant-graph-geheim",
};

/**
 * Every mail the SMTP stream transport delivered, and every attempt a
 * broken transporter refused. Module-level, because `MailerService` keeps
 * a transporter per configuration for the life of the process (see
 * `in-memory-mail-transport.js`); a test reads only what it sent itself.
 */
const smtpDeliveries = [];
const brokenAttempts = { count: 0 };

/**
 * One entry per transport. `create` puts the transport on the wire for the
 * current test and answers the instance and tenant configurations it runs
 * over plus `delivered()`, the mails as the transport took them, in the
 * shared shape `{ from, to, bcc, subject, body, attachmentNames }`, and
 * `attempts()`, how often a broken wire was tried. `create({ broken })`
 * answers an instance whose transport refuses every send.
 */
const IMPLEMENTATIONS = [
  {
    name: "smtp",
    create({ broken = false } = {}) {
      smtpDeliveries.length = 0;
      brokenAttempts.count = 0;
      const realCreateTransport = nodemailer.createTransport;
      sinon.stub(nodemailer, "createTransport").callsFake((config) => {
        if (/broken/.test(config.host)) {
          return {
            async sendMail() {
              brokenAttempts.count += 1;
              throw new Error("smtp: connection refused");
            },
          };
        }
        const stream = realCreateTransport({
          streamTransport: true,
          buffer: true,
          newline: "unix",
        });
        return {
          async sendMail(options) {
            const info = await stream.sendMail(options);
            smtpDeliveries.push(info);
            return info;
          },
        };
      });
      return {
        instance: {
          ...INSTANCE_SMTP,
          ...(broken && { noreplyHost: "smtp.broken.example.test" }),
        },
        tenant: { ...TENANT_SMTP },
        incompleteTenant: { ...TENANT_SMTP, noreplyDisplayName: "" },
        delivered: () =>
          smtpDeliveries.map((info) => {
            const message = info.message.toString("utf8");
            const [, subject = ""] = message.match(/^Subject: (.*)$/m) || [];
            return {
              from: info.envelope.from,
              to: info.envelope.to.slice(0, 1),
              bcc: info.envelope.to.slice(1),
              subject,
              body: message,
              attachmentNames: [
                ...message.matchAll(/filename=([^\r\n;]+)/g),
              ].map((match) => match[1]),
            };
          }),
        attempts: () => brokenAttempts.count,
      };
    },
  },
  {
    name: "graph",
    create({ broken = false } = {}) {
      const client = new FakeGraphMailClient({ broken }).install();
      return {
        instance: { ...INSTANCE_GRAPH },
        tenant: { ...TENANT_GRAPH },
        incompleteTenant: { ...TENANT_GRAPH, noreplyGraphClientSecret: null },
        delivered: () =>
          client.requests.map(({ body }) => ({
            from: body.message.from.emailAddress.address,
            to: body.message.toRecipients.map((r) => r.emailAddress.address),
            bcc: body.message.bccRecipients.map((r) => r.emailAddress.address),
            subject: body.message.subject,
            body: body.message.body.content,
            attachmentNames: body.message.attachments.map((a) => a.name),
          })),
        attempts: () => axiosCalls(),
      };
    },
  },
  {
    name: "in-memory",
    create({ broken = false } = {}) {
      const sink = installInMemoryMailTransport();
      return {
        instance: {
          ...INSTANCE_SMTP,
          noreplyHost: broken
            ? "in-memory.broken.example.test"
            : "in-memory.example.test",
        },
        tenant: { ...TENANT_SMTP, noreplyHost: "in-memory.mandant.test" },
        incompleteTenant: { ...TENANT_SMTP, noreplyMail: "" },
        delivered: () =>
          sink.map((options) => ({
            from: addressOf(options.from),
            to: [options.to],
            bcc: options.bcc ? [options.bcc] : [],
            subject: options.subject,
            body: options.html,
            attachmentNames: (options.attachments || []).map((a) => a.filename),
          })),
        attempts: () => refusedSends(),
      };
    },
  },
];

function axiosCalls() {
  const axios = require("axios");
  return axios.post.callCount;
}

for (const implementation of IMPLEMENTATIONS) {
  describe(`mail transport contract: ${implementation.name}`, function () {
    let transport;
    let instance;
    let tenant;

    /** The instance and the tenant as the store answers them. */
    function given({ instanceOverrides = {}, tenantOverrides = {} } = {}) {
      instance = {
        mailEnabled: true,
        ...transport.instance,
        ...instanceOverrides,
      };
      tenant = { id: TENANT, useInstanceMail: true, ...tenantOverrides };
      sinon.stub(InstanceManager, "getInstance").resolves(instance);
      sinon.stub(TenantManager, "getTenant").resolves(tenant);
    }

    const send = (overrides = {}) =>
      MailerService.send({
        tenantId: TENANT,
        address: TO,
        subject: SUBJECT,
        mailTemplate: "{{{content}}}",
        model: { content: HTML },
        attachments: [ATTACHMENT],
        bcc: BCC,
        useInstanceMail: tenant.useInstanceMail,
        ...overrides,
      });

    beforeEach(function () {
      transport = implementation.create();
    });

    afterEach(function () {
      sinon.restore();
    });

    it("delivers to, bcc, subject, body and the attachments by name, from the instance's no-reply account", async function () {
      given();

      await send();

      const [delivered] = transport.delivered();
      assert.strictEqual(transport.delivered().length, 1);
      assert.strictEqual(delivered.from, INSTANCE_SMTP.noreplyMail);
      assert.deepStrictEqual(delivered.to, [TO]);
      assert.deepStrictEqual(delivered.bcc, [BCC]);
      assert.strictEqual(delivered.subject, SUBJECT);
      assert.ok(delivered.body.includes(HTML));
      assert.deepStrictEqual(delivered.attachmentNames, [ATTACHMENT.filename]);
    });

    it("delivers an instance mail - no tenant - from the instance's account", async function () {
      given();

      await send({ tenantId: null, useInstanceMail: false });

      assert.strictEqual(
        transport.delivered()[0].from,
        INSTANCE_SMTP.noreplyMail,
      );
    });

    it("sends from the tenant's account where the tenant does not use the instance mail and its configuration is complete", async function () {
      given({ tenantOverrides: transport.tenant });

      await send();

      assert.strictEqual(
        transport.delivered()[0].from,
        transport.tenant.noreplyMail,
      );
    });

    it("falls back to the instance's account, silently, where the tenant's configuration is incomplete (spec 5.3: a warning after ticket 2)", async function () {
      given({ tenantOverrides: transport.incompleteTenant });

      await send();

      assert.strictEqual(
        transport.delivered()[0].from,
        INSTANCE_SMTP.noreplyMail,
      );
    });

    it("sends from the instance's account where the tenant uses the instance mail, whatever the tenant configured", async function () {
      given({
        tenantOverrides: { ...transport.tenant, useInstanceMail: true },
      });

      await send();

      assert.strictEqual(
        transport.delivered()[0].from,
        INSTANCE_SMTP.noreplyMail,
      );
    });

    it("sends nothing and answers nothing where the instance has mail disabled (spec 5.4: a skipped value after ticket 2)", async function () {
      given({ instanceOverrides: { mailEnabled: false } });

      const answer = await send();

      assert.strictEqual(answer, undefined);
      assert.strictEqual(transport.delivered().length, 0);
    });

    it("tries three times, a second apart and then two, and throws the transport's error", async function () {
      sinon.restore();
      transport = implementation.create({ broken: true });
      const clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
      given();

      const outcome = send().then(
        () => null,
        (error) => error,
      );
      await clock.tickAsync(1000);
      await clock.tickAsync(2000);
      const error = await outcome;

      assert.ok(error instanceof Error, "send() resolved instead of throwing");
      assert.strictEqual(transport.attempts(), 3);
      assert.strictEqual(transport.delivered().length, 0);
    });

    // --- the target form of ticket 2 ------------------------------------

    it.skip("answers { status: 'sent', transport: 'instance' | 'tenant', messageId } (ticket 2)", async function () {
      given();

      const outcome = await send();

      assert.strictEqual(outcome.status, "sent");
      assert.strictEqual(outcome.transport, "instance");
    });

    it.skip("answers { status: 'skipped', reason: 'mail_disabled' } where the instance has mail disabled (ticket 2)", async function () {
      given({ instanceOverrides: { mailEnabled: false } });

      const outcome = await send();

      assert.deepStrictEqual(outcome, {
        status: "skipped",
        reason: "mail_disabled",
      });
    });

    it.skip("warns once per tenant configuration when it falls back to the instance (ticket 2)", async function () {
      given({ tenantOverrides: transport.incompleteTenant });

      await send();
      await send();

      // One warn log "tenant mail config incomplete, falling back to
      // instance" for the configuration hash, not one per mail.
    });
  });
}

describe("mail transport pool: the configuration hash", function () {
  it("ignores the Graph client secret today, so a rotated secret keeps the old transporter (spec 5.5: in the hash after ticket 2)", function () {
    const before = MailerService.getConfigHash(INSTANCE_GRAPH);
    const rotated = MailerService.getConfigHash({
      ...INSTANCE_GRAPH,
      noreplyGraphClientSecret: "rotiert",
    });

    assert.strictEqual(rotated, before);
  });

  it("tells SMTP accounts apart by host, port, user, password and STARTTLS", function () {
    const base = MailerService.getConfigHash(INSTANCE_SMTP);
    for (const field of [
      "noreplyHost",
      "noreplyPort",
      "noreplyUser",
      "noreplyPassword",
      "noreplyStarttls",
    ]) {
      const changed = MailerService.getConfigHash({
        ...INSTANCE_SMTP,
        [field]: `${INSTANCE_SMTP[field]}-x`,
      });
      assert.notStrictEqual(changed, base, `${field} is not in the hash`);
    }
  });

  it.skip("tells two Graph accounts apart by their client secret (ticket 2)", function () {
    const before = MailerService.getConfigHash(INSTANCE_GRAPH);
    const rotated = MailerService.getConfigHash({
      ...INSTANCE_GRAPH,
      noreplyGraphClientSecret: "rotiert",
    });

    assert.notStrictEqual(rotated, before);
  });
});

describe("mail transport SMTP: the transporter configuration today", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("uses an implicit TLS pool, and for STARTTLS the legacy ciphers without certificate verification (own ticket outside the chain)", function () {
    const createTransport = sinon
      .stub(nodemailer, "createTransport")
      .returns({ async sendMail() {} });

    MailerService.getTransporter({
      ...INSTANCE_SMTP,
      noreplyHost: "smtp.tls.example.test",
    });
    MailerService.getTransporter({
      ...INSTANCE_SMTP,
      noreplyHost: "smtp.starttls.example.test",
      noreplyStarttls: true,
    });

    const [implicitTls] = createTransport.firstCall.args;
    const [starttls] = createTransport.secondCall.args;
    assert.deepStrictEqual(implicitTls, {
      pool: true,
      host: "smtp.tls.example.test",
      port: 465,
      secure: true,
      auth: { user: "instanz", pass: "instanz-geheim" },
    });
    assert.strictEqual(starttls.secure, false);
    assert.deepStrictEqual(starttls.tls, {
      ciphers: "SSLv3",
      rejectUnauthorized: false,
    });
  });
});
