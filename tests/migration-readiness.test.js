/**
 * Readiness waits for the migrations (tenant supervision spec §11): the
 * ready probe answers 503 until the migration run of this process has
 * succeeded, stays 503 when it failed, and hands over to the existing checks
 * afterwards.
 */

const { expect } = require("chai");
const express = require("express");
const request = require("supertest");

const {
  createMigrationState,
} = require("../src/commons/utilities/migration-state");

function probe(state) {
  const app = express();
  // What server.js mounts: the gate first, then the checks there were before.
  app.get("/healthz/ready", state.readinessGate, (req, res) => {
    res.status(200).json({ status: "ok" });
  });
  return request(app).get("/healthz/ready");
}

describe("readiness: the migration gate", function () {
  it("answers 503 naming the pending migrations before the run has finished", async function () {
    const state = createMigrationState();

    const res = await probe(state);

    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({
      status: "unavailable",
      details: { migrations: "pending" },
    });
  });

  it("stays 503 while the run is under way and hands over to the existing checks once it succeeded", async function () {
    const state = createMigrationState();
    let finish;
    const run = state.track(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    expect((await probe(state)).status).to.equal(503);

    finish();
    await run;
    const res = await probe(state);
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ status: "ok" });
  });

  it("keeps answering 503, naming the failure, when the run failed", async function () {
    const state = createMigrationState();
    const failure = new Error("boom");

    let caught;
    await state
      .track(async () => {
        throw failure;
      })
      .catch((error) => {
        caught = error;
      });

    // The failure is handed on, so the start-up logs it.
    expect(caught).to.equal(failure);
    const res = await probe(state);
    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({
      status: "unavailable",
      details: { migrations: "failed" },
    });
    // No internals in the probe's answer.
    expect(JSON.stringify(res.body)).to.not.include("boom");
  });
});
