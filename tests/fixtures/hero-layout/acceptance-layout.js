/**
 * The acceptance fixture of the Shared contract (hero-layout spec): the Bad
 * Belzig Hero, a claim on a white opaque Panel with the town's coat of arms
 * centred over its upper edge. It is the contract's JSON verbatim, with
 * `<wappen.mediaId>` filled by the medium below.
 *
 * The storefront copies this file for its own guard tests
 * (`smart-city-booking-store-front`, hero-layout-impl). A change to the layout
 * is a change to the Shared contract in all three repo specs, never a local
 * decision. Nothing here reads a constant out of `src/`, on purpose: the
 * layout is written out in full so the file states the contract on its own.
 *
 * Every field the amendment adds appears here at least once. Both Blocks are
 * `width: "sm"` — 20 rem — so the Panel is 20 rem wide and the crest has a
 * 20 rem box to be placed in. `align: "center"` puts the crest's centre at
 * 10 rem, the Panel's own centre; the claim keeps `auto`, which in a
 * `middle-left` Zone is left. The crest Block comes first, so it sits directly
 * on top of the claim and reads above it on mobile; one step of `y` pushes it
 * half a rem down onto the Panel's upper edge, and `layer: "front"` is what
 * paints it over the Panel rather than under it. The Panel is opaque, so its
 * `blur: true` — the „Glas“ default, untouched by the author — paints nothing.
 * The claim's two lines carry their size and colour as classes over a Block
 * that is `md` and `default`, and survive the class pass without a repair.
 */

// The media id of the coat of arms; the tests hand the media lookup a public
// instance image under this id.
const CREST_MEDIA_ID = "66f1c2aa-0000-4000-8000-000000000004";

const ACCEPTANCE_LAYOUT = Object.freeze({
  version: 1,
  height: "lg",
  mobileHeight: "lg",
  compactHeight: "sm",
  blocks: [
    {
      id: "belzig-crest",
      type: "image",
      zone: "middle-left",
      outerSpacing: "none",
      innerSpacing: "none",
      width: "sm",
      align: "center",
      panel: null,
      offset: { x: 0, y: 0.5 },
      layer: "front",
      homeOnly: false,
      hideOnMobile: false,
      image: { source: "media", mediaId: CREST_MEDIA_ID },
      alt: { de: "Wappen der Stadt Bad Belzig" },
      maxHeight: "sm",
      invertInDarkMode: false,
    },
    {
      id: "belzig-claim",
      type: "richtext",
      zone: "middle-left",
      outerSpacing: "none",
      innerSpacing: "md",
      width: "sm",
      align: "auto",
      panel: { color: "white", opacity: 100, radius: "md", blur: true },
      offset: { x: 0, y: 0 },
      layer: "back",
      homeOnly: false,
      hideOnMobile: false,
      html: {
        de: '<p><span class="hero-size-2xl hero-color-primary"><strong>Einfach buchen.</strong></span></p><p><span class="hero-size-md hero-color-default">Alle Angebote in und um Bad Belzig zentral an einem Ort.</span></p>',
      },
      size: "md",
      color: "default",
      shadow: false,
    },
  ],
});

module.exports = {
  ACCEPTANCE_LAYOUT,
  CREST_MEDIA_ID,
};
