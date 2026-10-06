/**
 * The card link mail and the route it points to: without a link URL of the
 * caller (the Admin UI sends none), the mail links to the backend's own
 * confirmation route, and that route has to answer under the path the mail
 * builds - with the authentication router mounted at `/auth`, as in
 * `server.js`.
 */

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const sinon = require("sinon");

const { MailType } = require("../src/commons/mail-service/mail-types");
const CardAuthService = require("../src/commons/services/card-auth/card-auth-service");

const BACKEND_URL = "https://api.example.test";
const FRONTEND_URL = "https://admin.example.test";

function createApp() {
  const app = express();
  app.use(
    "/auth",
    require("../src/platform/authentication/authentication-router"),
  );
  return app;
}

describe("card link: the mail's backend link reaches the confirmation route", function () {
  let savedEnv;

  beforeEach(function () {
    savedEnv = {
      BACKEND_URL: process.env.BACKEND_URL,
      FRONTEND_URL: process.env.FRONTEND_URL,
    };
    process.env.BACKEND_URL = BACKEND_URL;
    process.env.FRONTEND_URL = FRONTEND_URL;
  });

  afterEach(function () {
    sinon.restore();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("confirms the link and redirects to the success page", async function () {
    const confirm = sinon.stub(CardAuthService, "confirmCardLink").resolves();
    const { linkUrl } = MailType.CARD_LINK_REQUEST.templateData({
      to: "erika@example.test",
      hookId: "hook-card-1",
    });
    const { pathname, search } = new URL(linkUrl);

    const response = await request(createApp()).get(`${pathname}${search}`);

    assert.strictEqual(response.status, 302);
    assert.strictEqual(
      response.headers.location,
      `${FRONTEND_URL}/auth/card/link-success`,
    );
    sinon.assert.calledOnceWithExactly(
      confirm,
      "hook-card-1",
      "erika@example.test",
    );
  });
});
