/**
 * `POST /auth/resetpassword` (ticket ECCdigital/tickets#264): the password
 * change of the signed-in account. Once it set a password hash of the
 * caller's choosing for any account named in the body, anonymously, and
 * mailed the account the link that put it in force - one click and the
 * account was taken over. Now it asks for a session and the current
 * password, and changes only the password of the signed-in account.
 *
 * Runs on the lifecycle harness (signed bearer per principal, the mails at
 * the transport); the user store is a map the tests fill.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const passwordHash = require("password-hash");

const {
  installHarness,
  CUSTOMER,
  OWNER,
} = require("./helpers/booking-lifecycle-harness");
const UserManager = require("../src/commons/data-managers/user-manager");
const { User } = require("../src/commons/entities/user/user");

const CURRENT = "bisheriges-Passwort-1";
const CHOSEN = "neues-Passwort-2";
const SSO_USER = "sso@example.test";

describe("POST /auth/resetpassword: signed in, own account, current password", function () {
  this.timeout(20000);

  let h;
  let users;

  function account(id, overrides = {}) {
    return new User({
      id,
      firstName: "Erika",
      lastName: "Muster",
      secret: passwordHash.generate(CURRENT),
      isVerified: true,
      authType: "local",
      hooks: [],
      ...overrides,
    });
  }

  /** The hooks waiting to put a password in force, per account. */
  function pendingResets(id) {
    return users
      .get(id)
      .hooks.filter(
        (hook) => hook.type === "reset-password" && hook.status === "active",
      );
  }

  function resetMails() {
    return h
      .takeEffects()
      .filter((row) => row.startsWith("mail.PASSWORD_RESET"));
  }

  beforeEach(async function () {
    h = await installHarness();
    users = new Map(
      [
        account(CUSTOMER),
        account(OWNER),
        account(SSO_USER, { authType: "keycloak", secret: undefined }),
      ].map((user) => [user.id, user]),
    );
    UserManager.getUser.callsFake(async (id, withSensitive = false) => {
      const user = users.get(id);
      if (!user) return { id };
      return withSensitive ? user : user.exportPublic();
    });
    sinon.stub(UserManager, "updateUser").callsFake(async (user) => {
      users.set(user.id, user);
      return user;
    });
    h.clearEffects();
  });

  afterEach(async function () {
    sinon.restore();
    await h.close();
  });

  it("refuses an anonymous caller and sets nothing for the account named", async function () {
    const res = await h
      .api()
      .post("/auth/resetpassword")
      .send({ id: OWNER, password: CHOSEN });

    expect(res.status).to.equal(401);
    expect(pendingResets(OWNER)).to.deep.equal([]);
    expect(resetMails()).to.deep.equal([]);
  });

  it("refuses a signed-in caller without the current password", async function () {
    const res = await h
      .api()
      .post("/auth/resetpassword")
      .set(h.as(CUSTOMER))
      .send({ id: CUSTOMER, password: CHOSEN });

    expect(res.status).to.equal(400);
    expect(pendingResets(CUSTOMER)).to.deep.equal([]);
    expect(resetMails()).to.deep.equal([]);
  });

  it("refuses a wrong current password", async function () {
    const res = await h
      .api()
      .post("/auth/resetpassword")
      .set(h.as(CUSTOMER))
      .send({ currentPassword: "geraten", password: CHOSEN });

    expect(res.status).to.equal(403);
    expect(pendingResets(CUSTOMER)).to.deep.equal([]);
    expect(resetMails()).to.deep.equal([]);
  });

  it("refuses an account without a password of its own (SSO)", async function () {
    const res = await h
      .api()
      .post("/auth/resetpassword")
      .set(h.as(SSO_USER))
      .send({ currentPassword: CURRENT, password: CHOSEN });

    expect(res.status).to.equal(403);
    expect(pendingResets(SSO_USER)).to.deep.equal([]);
    expect(resetMails()).to.deep.equal([]);
  });

  it("changes the password of the signed-in account with the current one", async function () {
    const res = await h
      .api()
      .post("/auth/resetpassword")
      .set(h.as(CUSTOMER))
      .send({ currentPassword: CURRENT, password: CHOSEN });

    expect(res.status).to.equal(200);
    const [hook] = pendingResets(CUSTOMER);
    expect(passwordHash.verify(CHOSEN, hook.payload.secret)).to.equal(true);
    expect(resetMails()).to.deep.equal([`mail.PASSWORD_RESET ${CUSTOMER}`]);
  });

  it("changes only the own password, whatever account the body names", async function () {
    const res = await h
      .api()
      .post("/auth/resetpassword")
      .set(h.as(CUSTOMER))
      .send({ id: OWNER, currentPassword: CURRENT, password: CHOSEN });

    expect(res.status).to.equal(200);
    expect(pendingResets(OWNER)).to.deep.equal([]);
    expect(pendingResets(CUSTOMER)).to.have.length(1);
    expect(resetMails()).to.deep.equal([`mail.PASSWORD_RESET ${CUSTOMER}`]);
  });
});
