/**
 * The Keycloak-URL of the instance without a trailing slash
 * (ECCdigital/tickets#91). The backend drops it when it reads and when it
 * saves the Keycloak application of the instance, so the API answers (the
 * public instance too), the token check and the SSO sign-in all build on the
 * same URL, and a URL stored with the slash needs no migration.
 *
 * The instance is saved and read through the real model, its hooks included;
 * only the collection behind it is faked.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const axios = require("axios");
const jwt = require("jsonwebtoken");

const SsoService = require("../src/commons/services/sso/sso-service");
const KeycloakVerifier = require("../src/commons/utilities/keycloak-verifier");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const InstanceModel = require("../src/commons/data-managers/models/instanceModel");

/** A plain copy, as a document comes out of and goes into the database. */
function asStored(value) {
  return JSON.parse(JSON.stringify(value));
}

function keycloakApp(serverUrl) {
  return {
    type: "auth",
    id: "keycloak",
    active: true,
    title: "Keycloak",
    serverUrl,
    realm: "city",
    publicClient: "booking-client",
    privateClient: "backend",
    privateClientSecret: null,
    roleMapping: { active: false },
  };
}

describe("the Keycloak-URL of the instance", function () {
  let stored;
  let written;

  beforeEach(function () {
    stored = { bookableCustomFields: [], applications: [] };
    written = null;

    sinon
      .stub(InstanceModel.collection, "findOne")
      .callsFake(async () => asStored(stored));
    sinon
      .stub(InstanceModel.collection, "findOneAndUpdate")
      .callsFake(async (filter, update) => {
        written = update.$set;
        stored = { ...stored, ...asStored(written) };
        return asStored(stored);
      });
    sinon.stub(InstanceModel.collection, "updateOne").resolves();
  });

  afterEach(function () {
    sinon.restore();
  });

  function writtenKeycloakUrl() {
    return written.applications.find((app) => app.id === "keycloak").serverUrl;
  }

  describe("on saving the instance", function () {
    it("stores the URL without the trailing slash", async function () {
      await InstanceManager.updateInstance({
        applications: [keycloakApp("https://idp.example.test/")],
      });

      expect(writtenKeycloakUrl()).to.equal("https://idp.example.test");
    });

    it("drops every trailing slash and keeps the path before them", async function () {
      await InstanceManager.updateInstance({
        applications: [keycloakApp("https://idp.example.test/auth//")],
      });

      expect(writtenKeycloakUrl()).to.equal("https://idp.example.test/auth");
    });

    it("answers the saved instance with the URL without the trailing slash", async function () {
      const saved = await InstanceManager.updateInstance({
        applications: [keycloakApp("https://idp.example.test/")],
      });

      expect(saved.exportWithMedia().applications[0].serverUrl).to.equal(
        "https://idp.example.test",
      );
    });
  });

  describe("on reading an instance stored with the trailing slash", function () {
    beforeEach(function () {
      stored.applications = [keycloakApp("https://idp.example.test/")];
    });

    it("answers the URL without it", async function () {
      const instance = await InstanceManager.getInstance();

      expect(instance.exportWithMedia().applications[0].serverUrl).to.equal(
        "https://idp.example.test",
      );
    });

    it("answers the URL without it in the public instance", async function () {
      const instance = await InstanceManager.getInstance();
      instance.removePrivateData();

      expect(instance.exportWithMedia().applications[0].serverUrl).to.equal(
        "https://idp.example.test",
      );
    });

    describe("where the backend builds on it", function () {
      let post;

      beforeEach(function () {
        KeycloakVerifier.clearCache();
        post = sinon.stub(axios, "post").resolves({ data: { active: false } });
      });

      afterEach(function () {
        KeycloakVerifier.clearCache();
      });

      it("signs in over SSO at the introspection endpoint under the URL without it", async function () {
        const token = jwt.sign({ aud: "backend" }, "not-checked-here");

        await SsoService.handleLogin(token).catch(() => {});

        expect(post.firstCall.args[0]).to.equal(
          "https://idp.example.test/realms/city/protocol/openid-connect/token/introspect",
        );
      });

      it("checks a token against the issuer under the URL without it", async function () {
        expect(await KeycloakVerifier.getRealmUrl()).to.equal(
          "https://idp.example.test/realms/city",
        );
      });
    });
  });
});
