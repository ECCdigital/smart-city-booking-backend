/**
 * The tenants of the instance catalog bundle carry what the storefront's
 * „Angebot nach Anbietern“ shows (ECCdigital/tickets#478): the short
 * description and the number of listed bookables and events. Listed is the
 * public projection's word (ADR 0003); this suite checks that the bundle
 * asks it and counts on top: no tickets, no event that has ended.
 */

const { expect } = require("chai");
const sinon = require("sinon");

const CatalogService = require("../src/commons/services/catalog-service");
const CatalogManager = require("../src/commons/data-managers/catalog-manager");
const InstanceManager = require("../src/commons/data-managers/instance-manager");
const TenantManager = require("../src/commons/data-managers/tenant-manager");
const {
  BookableManager,
} = require("../src/commons/data-managers/bookable-manager");
const EventManager = require("../src/commons/data-managers/event-manager");
const { Catalog } = require("../src/commons/entities/catalog/catalog");
const { Event } = require("../src/commons/entities/event/event");
const { PUBLIC } = require("../src/commons/services/authorization/reach");

const NOW = new Date("2026-10-13T12:00:00");

const tenant = (id, extra = {}) => ({
  id,
  name: id,
  catalogParticipation: { visible: true },
  ...extra,
});

const event = (endDate) =>
  new Event({ id: `e-${endDate}`, information: { endDate } });

describe("the tenants of the catalog bundle: description and offer counts", function () {
  let clock;

  beforeEach(function () {
    clock = sinon.useFakeTimers({ now: NOW, toFake: ["Date"] });
    sinon
      .stub(CatalogManager, "getInstanceCatalog")
      .resolves(new Catalog({ id: "ic", name: "Instanz", type: "instance" }));
    sinon.stub(InstanceManager, "getBranding").resolves({});
    sinon
      .stub(InstanceManager, "getPortalConfig")
      .resolves({ publicOffersEnabled: true, portalUrl: "" });
  });

  afterEach(function () {
    clock.restore();
    sinon.restore();
  });

  it("carries the description and counts the listed offers", async function () {
    sinon
      .stub(TenantManager, "getTenants")
      .resolves([tenant("verein", { description: "Sport im Quartier." })]);
    const getBookables = sinon.stub(BookableManager, "getBookables").resolves([
      { id: "room", type: "room" },
      { id: "bike", type: "resource" },
      { id: "ticket", type: "ticket", eventId: "e" },
    ]);
    const getEvents = sinon
      .stub(EventManager, "getEvents")
      .resolves([
        event("2026-10-12"),
        event("2026-10-13"),
        event("2026-12-01"),
      ]);

    const { tenants } = await CatalogService.getCatalogBundle();

    expect(tenants[0]).to.include({
      id: "verein",
      description: "Sport im Quartier.",
      bookableCount: 2,
      eventCount: 2,
    });
    expect(getBookables.calledWith("verein", PUBLIC)).to.equal(true);
    expect(getEvents.calledWith("verein", PUBLIC)).to.equal(true);
  });

  it("answers an empty description and zero counts for a tenant without either", async function () {
    sinon.stub(TenantManager, "getTenants").resolves([tenant("leer")]);
    sinon.stub(BookableManager, "getBookables").resolves([]);
    sinon.stub(EventManager, "getEvents").resolves([]);

    const { tenants } = await CatalogService.getCatalogBundle();

    expect(tenants[0]).to.include({
      description: "",
      bookableCount: 0,
      eventCount: 0,
    });
  });

  it("counts nothing for a tenant the catalog leaves out", async function () {
    sinon
      .stub(TenantManager, "getTenants")
      .resolves([
        tenant("hidden", { catalogParticipation: { visible: false } }),
      ]);
    const getBookables = sinon.stub(BookableManager, "getBookables");
    const getEvents = sinon.stub(EventManager, "getEvents");

    const { tenants } = await CatalogService.getCatalogBundle();

    expect(tenants).to.have.length(0);
    expect(getBookables.called).to.equal(false);
    expect(getEvents.called).to.equal(false);
  });
});
