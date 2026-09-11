/**
 * The Background fixtures of the Shared contract (hero-layout spec) and the
 * invalid inputs the normaliser has to refuse, each with the JSON path and
 * code it answers with.
 *
 * The storefront copies this file for its own guard tests
 * (`smart-city-booking-store-front`, hero-layout-impl). The three valid
 * objects are the contract's examples verbatim; a change to them is a change
 * to the Shared contract in all three repo specs, never a local decision.
 */

// The `variant` example of the contract, and at the same time the default
// Background a fresh instance is exported with.
const VARIANT_BACKGROUND = Object.freeze({
  version: 1,
  type: "variant",
  variant: "poly",
  orbs: true,
  noise: true,
  intensity: "normal",
});

const COLOR_BACKGROUND = Object.freeze({
  version: 1,
  type: "color",
  light: "#f3f4f6",
  dark: "#111827",
});

// The media id of the image Background below; the tests hand the guard a
// public instance image under this id.
const IMAGE_MEDIA_ID = "66f1c2aa-0000-4000-8000-000000000001";

const IMAGE_BACKGROUND = Object.freeze({
  version: 1,
  type: "image",
  image: { source: "media", mediaId: IMAGE_MEDIA_ID },
  focalPoint: { x: 50, y: 35 },
  overlay: {
    light: { color: "#000000", opacity: 40 },
    dark: { color: "#000000", opacity: 60 },
  },
});

/**
 * Every invalid Background with the detail it is answered with. `field` is the
 * JSON path into the request body of the hero-layout routes, where the
 * Background sits at the top level under `background`.
 */
const INVALID_BACKGROUNDS = Object.freeze([
  {
    name: "an unknown key at the top level",
    input: { ...VARIANT_BACKGROUND, sparkles: true },
    expected: [{ field: "background.sparkles", code: "unknown_field" }],
  },
  {
    name: "an unknown key inside the overlay",
    input: {
      ...IMAGE_BACKGROUND,
      overlay: { light: { color: "#000000", opacity: 40, blur: 3 } },
    },
    expected: [
      { field: "background.overlay.light.blur", code: "unknown_field" },
    ],
  },
  {
    name: "an unknown version",
    input: { ...VARIANT_BACKGROUND, version: 2 },
    expected: [{ field: "background.version", code: "invalid_enum" }],
  },
  {
    name: "an unknown type",
    input: { version: 1, type: "video" },
    expected: [{ field: "background.type", code: "invalid_enum" }],
  },
  {
    name: "an unknown variant",
    input: { ...VARIANT_BACKGROUND, variant: "waves" },
    expected: [{ field: "background.variant", code: "invalid_enum" }],
  },
  {
    name: "an unknown intensity",
    input: { ...VARIANT_BACKGROUND, intensity: "loud" },
    expected: [{ field: "background.intensity", code: "invalid_enum" }],
  },
  {
    name: "a shorthand hex",
    input: { version: 1, type: "color", light: "#fff" },
    expected: [{ field: "background.light", code: "invalid_format" }],
  },
  {
    name: "an alpha hex",
    input: { version: 1, type: "color", light: "#ffffff80" },
    expected: [{ field: "background.light", code: "invalid_format" }],
  },
  {
    name: "a hex without the hash",
    input: { version: 1, type: "color", light: "ffffff" },
    expected: [{ field: "background.light", code: "invalid_format" }],
  },
  {
    name: "a missing version",
    input: { type: "color", light: "#ffffff" },
    expected: [{ field: "background.version", code: "required" }],
  },
  {
    name: "a missing type",
    input: { version: 1 },
    expected: [{ field: "background.type", code: "required" }],
  },
  {
    name: "a missing variant",
    input: { version: 1, type: "variant" },
    expected: [{ field: "background.variant", code: "required" }],
  },
  {
    name: "a colour Background without light",
    input: { version: 1, type: "color", dark: "#111827" },
    expected: [{ field: "background.light", code: "required" }],
  },
  {
    name: "an overlay without light",
    input: {
      ...IMAGE_BACKGROUND,
      overlay: { dark: { color: "#000000", opacity: 60 } },
    },
    expected: [{ field: "background.overlay.light", code: "required" }],
  },
  {
    name: "an image Background without an image",
    input: { version: 1, type: "image" },
    expected: [{ field: "background.image", code: "required" }],
  },
  {
    name: "an opacity above 100",
    input: {
      ...IMAGE_BACKGROUND,
      overlay: { light: { color: "#000000", opacity: 140 } },
    },
    expected: [
      { field: "background.overlay.light.opacity", code: "invalid_format" },
    ],
  },
  {
    name: "a fractional focal point",
    input: { ...IMAGE_BACKGROUND, focalPoint: { x: 50.5, y: 35 } },
    expected: [{ field: "background.focalPoint.x", code: "invalid_format" }],
  },
  {
    name: "a negative focal point",
    input: { ...IMAGE_BACKGROUND, focalPoint: { x: -1, y: 35 } },
    expected: [{ field: "background.focalPoint.x", code: "invalid_format" }],
  },
  {
    name: "a non-boolean switch",
    input: { ...VARIANT_BACKGROUND, orbs: "yes" },
    expected: [{ field: "background.orbs", code: "invalid_format" }],
  },
  {
    name: "several faults at once, in document order",
    input: { version: 1, type: "color", light: "#fff", dark: "#0f0", glow: 1 },
    expected: [
      { field: "background.light", code: "invalid_format" },
      { field: "background.dark", code: "invalid_format" },
      { field: "background.glow", code: "unknown_field" },
    ],
  },
]);

module.exports = {
  COLOR_BACKGROUND,
  IMAGE_BACKGROUND,
  IMAGE_MEDIA_ID,
  INVALID_BACKGROUNDS,
  VARIANT_BACKGROUND,
};
