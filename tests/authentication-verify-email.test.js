/**
 * `POST /auth/verify-email` hands the signup's return target back to the
 * client that verified (ticket 01): the verify page opened from the mail
 * sends the user on to the login with it.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const AuthenticationController = require("../src/platform/authentication/controllers/authentication-controller");
const UserService = require("../src/commons/services/user-service");

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("POST /auth/verify-email", function () {
  afterEach(function () {
    sinon.restore();
  });

  it("answers the return target the signup named", async function () {
    sinon
      .stub(UserService, "verifyEmail")
      .resolves({ success: true, nextUrl: "/tenants/new" });
    const res = response();

    await AuthenticationController.verifyEmail(
      { body: { token: "hook-1", id: "erika@example.test" } },
      res,
    );

    expect(res.statusCode).to.equal(200);
    expect(res.body).to.deep.equal({
      success: true,
      message: "Email verified successfully",
      nextUrl: "/tenants/new",
    });
  });

  it("answers null when the signup named none", async function () {
    sinon
      .stub(UserService, "verifyEmail")
      .resolves({ success: true, nextUrl: null });
    const res = response();

    await AuthenticationController.verifyEmail(
      { body: { token: "hook-1", id: "erika@example.test" } },
      res,
    );

    expect(res.statusCode).to.equal(200);
    expect(res.body.nextUrl).to.equal(null);
  });

  it("keeps the failure answers as they were", async function () {
    sinon
      .stub(UserService, "verifyEmail")
      .rejects({ message: "User already verified", status: 410 });
    const res = response();

    await AuthenticationController.verifyEmail(
      { body: { token: "hook-1", id: "erika@example.test" } },
      res,
    );

    expect(res.statusCode).to.equal(410);
    expect(res.body).to.equal("User already verified");
  });
});
