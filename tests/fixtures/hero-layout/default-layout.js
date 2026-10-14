/**
 * The Default Hero Layout of the Shared contract (hero-layout spec), the
 * layout the backend derives when a Catalog stores none. It is the contract's
 * JSON verbatim, with the placeholder `<catalog.name>` filled with the Portal
 * Name below. Its logo Block follows the app logo (`source: "app-logo"`,
 * ECCdigital/tickets#522) and is there only while the branding carries a logo
 * medium, such as the one below.
 *
 * The storefront copies this file for its own guard tests
 * (`smart-city-booking-store-front`, hero-layout-impl). A change to the layout
 * is a change to the Shared contract in all three repo specs, never a local
 * decision.
 */

// The Portal Name the fixture is derived for.
const PORTAL_NAME = "Stadt Musterstadt";

// The media id of the branding logo; the tests hand the media lookup a public
// instance image under this id.
const LOGO_MEDIA_ID = "66f1c2aa-0000-4000-8000-000000000002";

const DEFAULT_HERO_LAYOUT = Object.freeze({
  version: 1,
  height: "lg",
  mobileHeight: "lg",
  compactHeight: "sm",
  blocks: [
    {
      id: "default-logo",
      type: "image",
      zone: "middle-right",
      outerSpacing: "none",
      innerSpacing: "none",
      width: "auto",
      align: "auto",
      panel: null,
      offset: { x: 0, y: 0 },
      layer: "back",
      homeOnly: false,
      hideOnMobile: false,
      image: { source: "app-logo" },
      alt: { de: PORTAL_NAME },
      maxHeight: "sm",
    },
    {
      id: "default-title",
      type: "text",
      zone: "middle-left",
      outerSpacing: "none",
      innerSpacing: "none",
      width: "auto",
      align: "auto",
      panel: null,
      offset: { x: 0, y: 0 },
      layer: "back",
      homeOnly: false,
      hideOnMobile: false,
      text: { de: PORTAL_NAME },
      size: "lg",
      color: "primary",
      weight: "bold",
      shadow: false,
    },
    {
      id: "default-subtitle",
      type: "text",
      zone: "middle-left",
      outerSpacing: "none",
      innerSpacing: "none",
      width: "auto",
      align: "auto",
      panel: null,
      offset: { x: 0, y: 0 },
      layer: "back",
      homeOnly: false,
      hideOnMobile: false,
      text: { de: "Entdecken Sie unsere Angebote", en: "Discover our offers" },
      size: "2xl",
      color: "default",
      weight: "bold",
      shadow: false,
    },
  ],
});

module.exports = {
  DEFAULT_HERO_LAYOUT,
  LOGO_MEDIA_ID,
  PORTAL_NAME,
};
