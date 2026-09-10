/**
 * The Hero Layout fixtures of the Shared contract (hero-layout spec) and the
 * invalid layouts the normaliser has to refuse, each with the JSON path and
 * code it answers with.
 *
 * The storefront copies this file for its own guard tests
 * (`smart-city-booking-store-front`, hero-layout-impl). The crowded rich-text
 * Block is the contract's example verbatim; a change to it is a change to the
 * Shared contract in all three repo specs, never a local decision. Nothing
 * here reads a constant out of `src/`, on purpose: the defaults are written
 * out so the file states the contract on its own and travels between the
 * repos unchanged.
 */

// The media id of the image Blocks below; the tests hand the media lookup a
// public instance image under this id.
const LAYOUT_MEDIA_ID = "66f1c2aa-0000-4000-8000-000000000003";

/**
 * The crowded-layout example of the contract: every common field named, both
 * locales filled, and HTML that survives the allowlist untouched.
 */
const CROWDED_RICHTEXT_BLOCK = Object.freeze({
  id: "k3Qm7aZp",
  type: "richtext",
  zone: "bottom-center",
  outerSpacing: "md",
  innerSpacing: "sm",
  width: "md",
  panel: "translucent",
  homeOnly: true,
  hideOnMobile: false,
  html: {
    de: '<p><strong>Öffnungszeiten:</strong> Mo–Fr 8–18 Uhr. <a href="mailto:info@example.org">Kontakt</a></p>',
    en: '<p><strong>Opening hours:</strong> Mon–Fri 8am–6pm. <a href="mailto:info@example.org">Contact</a></p>',
  },
  color: "white",
  shadow: true,
});

/** A layout around the Blocks it is given, at the required keys alone. */
const layoutOf = (...blocks) => ({ version: 1, blocks });

/** One Block of each type, at the four fields the contract requires. */
const MINIMAL_TEXT_BLOCK = Object.freeze({
  id: "t1",
  type: "text",
  zone: "top-left",
  text: { de: "Willkommen" },
});

const MINIMAL_RICHTEXT_BLOCK = Object.freeze({
  id: "r1",
  type: "richtext",
  zone: "bottom-left",
  html: { de: "<p>Hallo</p>" },
});

const MINIMAL_IMAGE_BLOCK = Object.freeze({
  id: "i1",
  type: "image",
  zone: "middle-right",
  image: { source: "media", mediaId: LAYOUT_MEDIA_ID },
  alt: { de: "Wappen" },
});

/** The common fields the normaliser fills on every Block. */
const FILLED_BLOCK_DEFAULTS = Object.freeze({
  outerSpacing: "none",
  innerSpacing: "none",
  width: "auto",
  panel: "none",
  homeOnly: false,
  hideOnMobile: false,
});

/**
 * The minimal layout of all three Block types, and what it is stored as: the
 * heights of the contract and every Block default filled in.
 */
const MINIMAL_LAYOUT = Object.freeze(
  layoutOf(MINIMAL_TEXT_BLOCK, MINIMAL_RICHTEXT_BLOCK, MINIMAL_IMAGE_BLOCK),
);

const MINIMAL_LAYOUT_STORED = Object.freeze({
  version: 1,
  height: "lg",
  mobileHeight: "lg",
  compactHeight: "sm",
  blocks: [
    {
      ...MINIMAL_TEXT_BLOCK,
      ...FILLED_BLOCK_DEFAULTS,
      size: "md",
      color: "default",
      weight: "normal",
      shadow: false,
    },
    {
      ...MINIMAL_RICHTEXT_BLOCK,
      ...FILLED_BLOCK_DEFAULTS,
      color: "default",
      shadow: false,
    },
    {
      ...MINIMAL_IMAGE_BLOCK,
      ...FILLED_BLOCK_DEFAULTS,
      maxHeight: "md",
      invertInDarkMode: false,
    },
  ],
});

// Thirteen Blocks: one over the twelve the contract allows.
const THIRTEEN_BLOCKS = Array.from({ length: 13 }, (_, index) => ({
  ...MINIMAL_TEXT_BLOCK,
  id: `t${index}`,
}));

// The two rich-text caps of the contract: 50 000 characters raw, 10 000 left
// after sanitising.
const OVER_LONG_RAW_HTML = `<p>${"a".repeat(50000)}</p>`;
const OVER_LONG_SANITIZED_HTML = `<p>${"b".repeat(10001)}</p>`;

/**
 * Every invalid layout with the details it is answered with. `field` is the
 * JSON path into the request body of the instance catalog PUT, where the
 * layout sits at the top level under `heroLayout`.
 */
const INVALID_LAYOUTS = Object.freeze([
  {
    name: "a localised string without its German",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, text: { en: "Welcome" } }),
    expected: [{ field: "heroLayout.blocks[0].text.de", code: "required" }],
  },
  {
    name: "a text Block without its text",
    input: layoutOf({ id: "t1", type: "text", zone: "top-left" }),
    expected: [{ field: "heroLayout.blocks[0].text", code: "required" }],
  },
  {
    name: "a rich-text Block without its html",
    input: layoutOf({ id: "r1", type: "richtext", zone: "top-left" }),
    expected: [{ field: "heroLayout.blocks[0].html", code: "required" }],
  },
  {
    name: "an image Block without its image",
    input: layoutOf({
      id: "i1",
      type: "image",
      zone: "top-left",
      alt: { de: "Wappen" },
    }),
    expected: [{ field: "heroLayout.blocks[0].image", code: "required" }],
  },
  {
    name: "an image Block without its alt text",
    input: layoutOf({
      id: "i1",
      type: "image",
      zone: "top-left",
      image: { source: "media", mediaId: LAYOUT_MEDIA_ID },
    }),
    expected: [{ field: "heroLayout.blocks[0].alt", code: "required" }],
  },
  {
    name: "a Block without an id",
    input: layoutOf({ type: "text", zone: "top-left", text: { de: "Hi" } }),
    expected: [{ field: "heroLayout.blocks[0].id", code: "required" }],
  },
  {
    name: "a Block without a type",
    input: layoutOf({ id: "t1", zone: "top-left", text: { de: "Hi" } }),
    expected: [{ field: "heroLayout.blocks[0].type", code: "required" }],
  },
  {
    name: "a Block without a zone",
    input: layoutOf({ id: "t1", type: "text", text: { de: "Hi" } }),
    expected: [{ field: "heroLayout.blocks[0].zone", code: "required" }],
  },
  {
    name: "a layout without a version",
    input: { blocks: [MINIMAL_TEXT_BLOCK] },
    expected: [{ field: "heroLayout.version", code: "required" }],
  },
  {
    name: "a layout without blocks",
    input: { version: 1 },
    expected: [{ field: "heroLayout.blocks", code: "required" }],
  },
  {
    name: "an unknown key at the layout level",
    input: { ...layoutOf(MINIMAL_TEXT_BLOCK), sparkles: true },
    expected: [{ field: "heroLayout.sparkles", code: "unknown_field" }],
  },
  {
    name: "an unknown key on a Block",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, glow: 3 }),
    expected: [{ field: "heroLayout.blocks[0].glow", code: "unknown_field" }],
  },
  {
    name: "an unknown locale",
    input: layoutOf({
      ...MINIMAL_TEXT_BLOCK,
      text: { de: "Hallo", fr: "Bonjour" },
    }),
    expected: [
      { field: "heroLayout.blocks[0].text.fr", code: "unknown_field" },
    ],
  },
  {
    name: "an unknown version",
    input: { ...layoutOf(MINIMAL_TEXT_BLOCK), version: 2 },
    expected: [{ field: "heroLayout.version", code: "invalid_enum" }],
  },
  {
    name: "an unknown height",
    input: { ...layoutOf(MINIMAL_TEXT_BLOCK), height: "huge" },
    expected: [{ field: "heroLayout.height", code: "invalid_enum" }],
  },
  {
    name: "an unknown compact height",
    input: { ...layoutOf(MINIMAL_TEXT_BLOCK), compactHeight: "none" },
    expected: [{ field: "heroLayout.compactHeight", code: "invalid_enum" }],
  },
  {
    name: "an unknown zone",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, zone: "middle" }),
    expected: [{ field: "heroLayout.blocks[0].zone", code: "invalid_enum" }],
  },
  {
    name: "an unknown Block type",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, type: "video" }),
    expected: [{ field: "heroLayout.blocks[0].type", code: "invalid_enum" }],
  },
  {
    name: "an unknown text size",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, size: "3xl" }),
    expected: [{ field: "heroLayout.blocks[0].size", code: "invalid_enum" }],
  },
  {
    name: "an unknown spacing",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, outerSpacing: "tiny" }),
    expected: [
      { field: "heroLayout.blocks[0].outerSpacing", code: "invalid_enum" },
    ],
  },
  {
    name: "an unknown image max height",
    input: layoutOf({ ...MINIMAL_IMAGE_BLOCK, maxHeight: "2xl" }),
    expected: [
      { field: "heroLayout.blocks[0].maxHeight", code: "invalid_enum" },
    ],
  },
  {
    name: "a shorthand hex colour",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, color: "#fff" }),
    expected: [{ field: "heroLayout.blocks[0].color", code: "invalid_format" }],
  },
  {
    name: "a colour token the contract does not name",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, color: "brand" }),
    expected: [{ field: "heroLayout.blocks[0].color", code: "invalid_format" }],
  },
  {
    name: "a Block id with a space in it",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, id: "my block" }),
    expected: [{ field: "heroLayout.blocks[0].id", code: "invalid_format" }],
  },
  {
    name: "a Block id over 64 characters",
    input: layoutOf({ ...MINIMAL_TEXT_BLOCK, id: "a".repeat(65) }),
    expected: [{ field: "heroLayout.blocks[0].id", code: "invalid_format" }],
  },
  {
    name: "two Blocks with one id",
    input: layoutOf(MINIMAL_TEXT_BLOCK, {
      ...MINIMAL_RICHTEXT_BLOCK,
      id: MINIMAL_TEXT_BLOCK.id,
    }),
    expected: [{ field: "heroLayout.blocks[1].id", code: "duplicate_id" }],
  },
  {
    name: "thirteen Blocks",
    input: layoutOf(...THIRTEEN_BLOCKS),
    expected: [{ field: "heroLayout.blocks", code: "max_items" }],
  },
  {
    name: "an over-long text",
    input: layoutOf({
      ...MINIMAL_TEXT_BLOCK,
      text: { de: "a".repeat(201) },
    }),
    expected: [{ field: "heroLayout.blocks[0].text.de", code: "max_length" }],
  },
  {
    name: "an over-long alt text",
    input: layoutOf({ ...MINIMAL_IMAGE_BLOCK, alt: { de: "a".repeat(201) } }),
    expected: [{ field: "heroLayout.blocks[0].alt.de", code: "max_length" }],
  },
  {
    name: "rich text over the raw cap",
    input: layoutOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: { de: OVER_LONG_RAW_HTML },
    }),
    expected: [{ field: "heroLayout.blocks[0].html.de", code: "max_length" }],
  },
  {
    name: "rich text whose sanitised form is over the cap",
    input: layoutOf({
      ...MINIMAL_RICHTEXT_BLOCK,
      html: { de: "<p>kurz</p>", en: OVER_LONG_SANITIZED_HTML },
    }),
    expected: [{ field: "heroLayout.blocks[0].html.en", code: "max_length" }],
  },
  {
    // The guard's three other refusals - a tenant medium, an intern one, a
    // document - depend on what the media library holds and are checked
    // against a stubbed medium; an external reference is refused from its
    // shape alone, so it belongs here.
    name: "an external image reference",
    input: layoutOf({
      ...MINIMAL_IMAGE_BLOCK,
      image: { source: "external", url: "https://example.org/bild.png" },
    }),
    expected: [{ field: "heroLayout.blocks[0].image", code: "invalid_custom" }],
  },
  {
    name: "several faults at once, in document order",
    input: {
      version: 1,
      height: "huge",
      blocks: [{ ...MINIMAL_TEXT_BLOCK, id: "my block", size: "3xl" }],
      glow: 1,
    },
    expected: [
      { field: "heroLayout.height", code: "invalid_enum" },
      { field: "heroLayout.blocks[0].id", code: "invalid_format" },
      { field: "heroLayout.blocks[0].size", code: "invalid_enum" },
      { field: "heroLayout.glow", code: "unknown_field" },
    ],
  },
]);

module.exports = {
  CROWDED_RICHTEXT_BLOCK,
  FILLED_BLOCK_DEFAULTS,
  INVALID_LAYOUTS,
  LAYOUT_MEDIA_ID,
  MINIMAL_IMAGE_BLOCK,
  MINIMAL_LAYOUT,
  MINIMAL_LAYOUT_STORED,
  MINIMAL_RICHTEXT_BLOCK,
  MINIMAL_TEXT_BLOCK,
  layoutOf,
};
