/**
 * The return target of a signup (`nextUrl`, e.g. the tenant self-creation a
 * Raumgeber came from) survives signup → verification mail → verification
 * (spec §6.3, ticket 01): the mail link carries it, the verification answers
 * it, and the legacy hook redirect keeps it. Only a target the storefront
 * can be sent back to is kept: a relative path or an address on the origin
 * of the verify URL or the frontend.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const Handlebars = require("handlebars");

const UserService = require("../src/commons/services/user-service");
const UserManager = require("../src/commons/data-managers/user-manager");
const { User } = require("../src/commons/entities/user/user");
const {
  installMailStackStore,
  CUSTOMER,
  FRONTEND_URL,
} = require("./helpers/mail-stack-fixtures");
const {
  installInMemoryMailTransport,
} = require("./helpers/in-memory-mail-transport");

const VERIFY_URL = `${FRONTEND_URL}/auth/verify`;
const link = (url) => Handlebars.Utils.escapeExpression(url);

describe("the return target of a signup", function () {
  let created;
  let sent;

  beforeEach(function () {
    installMailStackStore();
    sent = installInMemoryMailTransport();
    created = null;
    sinon.stub(UserManager, "createUser").callsFake(async (user) => {
      created = user;
      return user;
    });
    sinon.stub(UserManager, "updateUser").callsFake(async (user) => user);
    sinon
      .stub(UserManager, "getUserByHookID")
      .callsFake(async (hookId) =>
        created?.hooks.some((hook) => hook.id === hookId) ? created : null,
      );
  });

  afterEach(function () {
    sinon.restore();
  });

  function newUser() {
    const user = new User({ id: CUSTOMER, firstName: "Erika" });
    user.setPassword("secret");
    return user;
  }

  async function signUp(nextUrl) {
    await UserService.singUpUser(newUser(), nextUrl, VERIFY_URL);
    return created.hooks.find((hook) => hook.type === "verify");
  }

  it("is carried by the verification mail's link and answered by the verification", async function () {
    const hook = await signUp("/tenants/new?from=offers");

    const verification = sent.find(
      (mail) => mail.subject === "Bestätigen Sie Ihre E-Mail-Adresse",
    );
    expect(verification.html).to.include(
      link(
        `${VERIFY_URL}?token=${hook.id}&id=${encodeURIComponent(CUSTOMER)}&next=${encodeURIComponent("/tenants/new?from=offers")}`,
      ),
    );

    const result = await UserService.verifyEmail(hook.id, CUSTOMER);

    expect(result).to.deep.equal({
      success: true,
      nextUrl: "/tenants/new?from=offers",
    });
    expect(created.isVerified).to.equal(true);
  });

  it("is absent when the signup named none", async function () {
    const hook = await signUp(undefined);

    const verification = sent.find(
      (mail) => mail.subject === "Bestätigen Sie Ihre E-Mail-Adresse",
    );
    expect(verification.html).to.include(
      link(`${VERIFY_URL}?token=${hook.id}&id=${encodeURIComponent(CUSTOMER)}`),
    );
    expect(verification.html).not.to.include("next=");

    const result = await UserService.verifyEmail(hook.id, CUSTOMER);

    expect(result).to.deep.equal({ success: true, nextUrl: null });
  });

  it("keeps the legacy hook redirect's next parameter", async function () {
    const hook = await signUp("/tenants/new");

    const target = await UserService.releaseHook(hook.id);

    expect(target).to.equal(
      `/email/verify?next=${encodeURIComponent("/tenants/new")}`,
    );
  });

  it("keeps an absolute address on the verify URL's origin", async function () {
    const hook = await signUp(`${FRONTEND_URL}/tenants/new`);

    const result = await UserService.verifyEmail(hook.id, CUSTOMER);

    expect(result.nextUrl).to.equal(`${FRONTEND_URL}/tenants/new`);
  });

  it("drops a target on a foreign host, and a protocol-relative one", async function () {
    for (const foreign of [
      "https://evil.example.org/phish",
      "//evil.example.org/phish",
      "javascript:alert(1)",
    ]) {
      const hook = await signUp(foreign);

      const verification = sent[sent.length - 2];
      expect(verification.subject).to.equal(
        "Bestätigen Sie Ihre E-Mail-Adresse",
      );
      expect(verification.html).not.to.include("next=");
      const result = await UserService.verifyEmail(hook.id, CUSTOMER);
      expect(result.nextUrl).to.equal(null);
    }
  });
});
