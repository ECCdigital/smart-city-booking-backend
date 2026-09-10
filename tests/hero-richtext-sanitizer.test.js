const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");

const {
  HERO_RICHTEXT_ALLOWLIST,
  HERO_RICHTEXT_MAX_RAW_LENGTH,
  HERO_RICHTEXT_MAX_SANITIZED_LENGTH,
  loadHeroRichTextRuntime,
  sanitizeHeroRichText,
} = require("../src/commons/services/hero-layout/hero-richtext-sanitizer");
const { ValidationError } = require("../src/errors/ValidationError");

const FIELD = "heroLayout.blocks[0].html.de";

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected the sanitiser to reject");
}

describe("hero-richtext-sanitizer", function () {
  // The first call boots a jsdom window.
  this.timeout(10000);

  describe("allowlist", function () {
    it("is the frozen rich-text allowlist v1 of the Shared contract", function () {
      assert.ok(Object.isFrozen(HERO_RICHTEXT_ALLOWLIST));
      assert.deepStrictEqual(HERO_RICHTEXT_ALLOWLIST.ALLOWED_TAGS, [
        "p",
        "br",
        "strong",
        "em",
        "u",
        "a",
        "ul",
        "ol",
        "li",
        "span",
      ]);
      assert.deepStrictEqual(HERO_RICHTEXT_ALLOWLIST.ALLOWED_ATTR, [
        "href",
        "target",
        "rel",
        "class",
        "data-color",
      ]);
      assert.deepStrictEqual(HERO_RICHTEXT_ALLOWLIST.ADD_URI_SAFE_ATTR, [
        "data-color",
      ]);
      assert.strictEqual(
        HERO_RICHTEXT_ALLOWLIST.ALLOWED_URI_REGEXP.source,
        "^(?:https?|mailto):",
      );
      assert.strictEqual(HERO_RICHTEXT_ALLOWLIST.ALLOWED_URI_REGEXP.flags, "i");
      assert.strictEqual(HERO_RICHTEXT_ALLOWLIST.ALLOW_DATA_ATTR, false);
      assert.strictEqual(HERO_RICHTEXT_ALLOWLIST.ALLOW_ARIA_ATTR, false);
      assert.strictEqual(HERO_RICHTEXT_ALLOWLIST.KEEP_CONTENT, true);
      assert.deepStrictEqual(Object.keys(HERO_RICHTEXT_ALLOWLIST).sort(), [
        "ADD_URI_SAFE_ATTR",
        "ALLOWED_ATTR",
        "ALLOWED_TAGS",
        "ALLOWED_URI_REGEXP",
        "ALLOW_ARIA_ATTR",
        "ALLOW_DATA_ATTR",
        "KEEP_CONTENT",
      ]);
    });

    // `data-color` reaches the class pass only because ADD_URI_SAFE_ATTR keeps
    // it out of ALLOWED_URI_REGEXP, which no hex value passes. Pinned against
    // a copy of the frozen config that lacks that one key.
    it("carries data-color through only because of ADD_URI_SAFE_ATTR", async function () {
      const { purifier } = await loadHeroRichTextRuntime();
      const html = '<span data-color="#ff0000">t</span>';

      assert.strictEqual(
        purifier.sanitize(html, HERO_RICHTEXT_ALLOWLIST),
        html,
      );
      assert.strictEqual(
        purifier.sanitize(html, {
          ...HERO_RICHTEXT_ALLOWLIST,
          ADD_URI_SAFE_ATTR: [],
        }),
        "<span>t</span>",
      );
    });
  });

  describe("sanitize", function () {
    it("keeps every allowed tag and https / mailto links", async function () {
      const html =
        "<p>Hi <strong>b</strong> <em>i</em> <u>u</u><br>" +
        '<a href="https://example.org/x?y=1">web</a> ' +
        '<a href="http://example.org/">plain</a> ' +
        '<a href="mailto:info@example.org">mail</a></p>' +
        "<ul><li>one</li><li>two</li></ul><ol><li>1</li></ol>";

      const result = await sanitizeHeroRichText(html, FIELD);

      assert.strictEqual(result, html);
    });

    // DOMPurify runs ALLOWED_URI_REGEXP over the value of every allowed
    // attribute that is not URI-safe, and the contract's strict regexp has no
    // room for `_blank` or `noopener`. So the frozen config drops `target` and
    // `rel` although it lists them; the storefront's copy behaves the same.
    // Pinned here so a change is a contract change, not a surprise.
    it("drops target and rel under the frozen config, keeping the link", async function () {
      const result = await sanitizeHeroRichText(
        '<p><a href="https://example.org/" target="_blank" rel="noopener">web</a></p>',
        FIELD,
      );

      assert.strictEqual(
        result,
        '<p><a href="https://example.org/">web</a></p>',
      );
    });

    it("keeps the crowded rich-text Block of the Shared contract unchanged", async function () {
      const html =
        '<p><strong>Öffnungszeiten:</strong> Mo–Fr 8–18 Uhr. <a href="mailto:info@example.org">Kontakt</a></p>';

      assert.strictEqual(await sanitizeHeroRichText(html, FIELD), html);
    });

    it("drops a script payload", async function () {
      const result = await sanitizeHeroRichText(
        '<p>safe</p><script>alert("x")</script><p onclick="alert(1)">t</p>',
        FIELD,
      );

      assert.strictEqual(result, "<p>safe</p><p>t</p>");
    });

    it("strips a javascript: href and keeps the link text", async function () {
      const result = await sanitizeHeroRichText(
        '<p><a href="javascript:alert(1)">click</a></p>',
        FIELD,
      );

      assert.strictEqual(result, "<p><a>click</a></p>");
    });

    it("strips a relative href and keeps the link text", async function () {
      const result = await sanitizeHeroRichText(
        '<p><a href="/bookables">list</a> <a href="page.html">page</a></p>',
        FIELD,
      );

      assert.strictEqual(result, "<p><a>list</a> <a>page</a></p>");
    });

    it("strips a heading and keeps its text", async function () {
      const result = await sanitizeHeroRichText(
        "<h1>Title</h1><h2>Sub</h2><p>body</p>",
        FIELD,
      );

      assert.strictEqual(result, "TitleSub<p>body</p>");
    });

    it("strips style, data and aria attributes", async function () {
      const result = await sanitizeHeroRichText(
        '<p style="color:red" data-x="1" aria-label="l" class="c" id="i">t</p>',
        FIELD,
      );

      assert.strictEqual(result, "<p>t</p>");
    });

    it("strips an image and unknown inline tags but keeps their text", async function () {
      const result = await sanitizeHeroRichText(
        '<p><img src="https://example.org/a.png" alt="a"><span>s</span><b>b</b></p>',
        FIELD,
      );

      assert.strictEqual(result, "<p>sb</p>");
    });

    it("returns an empty string for an empty input", async function () {
      assert.strictEqual(await sanitizeHeroRichText("", FIELD), "");
    });
  });

  describe("class pass", function () {
    it("keeps the class vocabulary of the Shared contract unchanged", async function () {
      const html =
        '<p class="hero-align-center">' +
        '<span class="hero-size-lg hero-color-primary">groß</span> ' +
        '<span class="hero-size-2xl" data-color="#ff0000">bunt</span>' +
        "</p>";

      assert.strictEqual(await sanitizeHeroRichText(html, FIELD), html);
    });

    it("stores a custom colour lower-cased", async function () {
      const result = await sanitizeHeroRichText(
        '<p><span data-color="#FF0000">rot</span></p>',
        FIELD,
      );

      assert.strictEqual(
        result,
        '<p><span data-color="#ff0000">rot</span></p>',
      );
    });

    it("drops a token outside the vocabulary and keeps the text", async function () {
      const result = await sanitizeHeroRichText(
        '<p class="hero-align-auto promo">' +
          '<span class="hero-size-huge">a</span>' +
          '<span class="hero-color-black">b</span>' +
          '<span class="promo">c</span>' +
          "</p>",
        FIELD,
      );

      assert.strictEqual(result, "<p>abc</p>");
    });

    it("stores the class and the data-color of a span without its style", async function () {
      const result = await sanitizeHeroRichText(
        '<p><span class="hero-size-lg" data-color="#ff0000" style="color:#ff0000">t</span></p>',
        FIELD,
      );

      assert.strictEqual(
        result,
        '<p><span class="hero-size-lg" data-color="#ff0000">t</span></p>',
      );
    });

    it("drops class and data-color on every element but p and span", async function () {
      const result = await sanitizeHeroRichText(
        '<p><a href="https://example.org/" class="hero-color-primary" data-color="#ff0000">l</a>' +
          '<strong class="hero-size-lg">b</strong></p>' +
          '<ul class="hero-align-center"><li class="promo" data-color="#ff0000">i</li></ul>',
        FIELD,
      );

      assert.strictEqual(
        result,
        '<p><a href="https://example.org/">l</a><strong>b</strong></p>' +
          "<ul><li>i</li></ul>",
      );
    });

    it("unwraps a bare span between two nested marks", async function () {
      const outer = await sanitizeHeroRichText(
        '<p><span class="hero-color-primary"><span class="promo">t</span></span></p>',
        FIELD,
      );
      const inner = await sanitizeHeroRichText(
        '<p><span class="promo"><span class="hero-size-lg">t</span></span></p>',
        FIELD,
      );

      assert.strictEqual(
        outer,
        '<p><span class="hero-color-primary">t</span></p>',
      );
      assert.strictEqual(inner, '<p><span class="hero-size-lg">t</span></p>');
    });

    it("keeps the first token of a group in document order", async function () {
      const result = await sanitizeHeroRichText(
        '<p class="hero-align-right hero-align-center">' +
          '<span class="hero-size-lg hero-size-sm hero-color-white hero-color-primary">t</span>' +
          "</p>",
        FIELD,
      );

      assert.strictEqual(
        result,
        '<p class="hero-align-right">' +
          '<span class="hero-size-lg hero-color-white">t</span>' +
          "</p>",
      );
    });

    it("keeps a hero-color token and drops the data-color beside it", async function () {
      const result = await sanitizeHeroRichText(
        '<p><span class="hero-color-primary" data-color="#ff0000">t</span></p>',
        FIELD,
      );

      assert.strictEqual(
        result,
        '<p><span class="hero-color-primary">t</span></p>',
      );
    });

    it("keeps a custom colour beside a size token", async function () {
      const html =
        '<p><span class="hero-size-lg" data-color="#ff0000">t</span></p>';

      assert.strictEqual(await sanitizeHeroRichText(html, FIELD), html);
    });

    it("drops a data-color that is no #rrggbb and keeps the text", async function () {
      for (const value of ["red", "#FFF", "#GGGGGG", "#ff00", "rgb(1,2,3)"]) {
        assert.strictEqual(
          await sanitizeHeroRichText(
            '<p><span data-color="' + value + '">Text</span></p>',
            FIELD,
          ),
          "<p>Text</p>",
          value,
        );
      }
    });
  });

  describe("length caps", function () {
    it("caps the raw input at 50 000 characters", function () {
      assert.strictEqual(HERO_RICHTEXT_MAX_RAW_LENGTH, 50000);
    });

    it("caps the sanitised result at 10 000 characters", function () {
      assert.strictEqual(HERO_RICHTEXT_MAX_SANITIZED_LENGTH, 10000);
    });

    it("refuses raw input over the raw cap as max_length at the locale path", async function () {
      const raw = "a".repeat(HERO_RICHTEXT_MAX_RAW_LENGTH + 1);

      const error = await rejection(sanitizeHeroRichText(raw, FIELD));

      assert.ok(error instanceof ValidationError);
      assert.deepStrictEqual(error.errors, [
        {
          field: FIELD,
          code: "max_length",
          params: { max: HERO_RICHTEXT_MAX_RAW_LENGTH, actual: raw.length },
        },
      ]);
    });

    it("refuses a sanitised result over the cap as max_length at the locale path", async function () {
      const raw =
        "<p>" + "a".repeat(HERO_RICHTEXT_MAX_SANITIZED_LENGTH) + "</p>";

      const error = await rejection(sanitizeHeroRichText(raw, FIELD));

      assert.ok(error instanceof ValidationError);
      assert.deepStrictEqual(error.errors, [
        {
          field: FIELD,
          code: "max_length",
          params: {
            max: HERO_RICHTEXT_MAX_SANITIZED_LENGTH,
            actual: raw.length,
          },
        },
      ]);
    });

    it("measures the cap after sanitising, so stripped markup does not count", async function () {
      const text = "a".repeat(HERO_RICHTEXT_MAX_SANITIZED_LENGTH - 7);
      const raw =
        '<img src="https://example.org/a.png">'.repeat(300) +
        "<p>" +
        text +
        "</p>";
      assert.ok(raw.length > HERO_RICHTEXT_MAX_SANITIZED_LENGTH);
      assert.ok(raw.length <= HERO_RICHTEXT_MAX_RAW_LENGTH);

      const result = await sanitizeHeroRichText(raw, FIELD);

      assert.strictEqual(result, "<p>" + text + "</p>");
    });

    // The order of the contract: the class pass stands before the cap, so a
    // text that was only over it because of junk classes is stored, not
    // refused for markup that goes anyway.
    it("measures the cap after the class pass, so junk classes do not count", async function () {
      const text = "a".repeat(5000);
      const raw = '<p class="' + "promo ".repeat(1000).trim() + '">' + text;
      assert.ok(raw.length > HERO_RICHTEXT_MAX_SANITIZED_LENGTH);
      assert.ok(raw.length <= HERO_RICHTEXT_MAX_RAW_LENGTH);

      const result = await sanitizeHeroRichText(raw, FIELD);

      assert.strictEqual(result, "<p>" + text + "</p>");
    });

    it("accepts a sanitised result exactly at the cap", async function () {
      const raw =
        "<p>" + "a".repeat(HERO_RICHTEXT_MAX_SANITIZED_LENGTH - 7) + "</p>";
      assert.strictEqual(raw.length, HERO_RICHTEXT_MAX_SANITIZED_LENGTH);

      assert.strictEqual(await sanitizeHeroRichText(raw, FIELD), raw);
    });
  });

  describe("purifier lifecycle", function () {
    it("does not load jsdom when the module is required", function () {
      const script =
        'require(process.argv[1]); process.stdout.write(String(Object.keys(require.cache).some((k) => k.includes("/node_modules/jsdom/"))));';
      const modulePath = path.resolve(
        __dirname,
        "../src/commons/services/hero-layout/hero-richtext-sanitizer.js",
      );

      const loaded = execFileSync(
        process.execPath,
        ["-e", script, modulePath],
        {
          encoding: "utf8",
        },
      );

      assert.strictEqual(loaded, "false");
    });

    it("creates the jsdom window once and reuses the purifier across calls", async function () {
      const { purifier: first } = await loadHeroRichTextRuntime();
      await sanitizeHeroRichText("<p>a</p>", FIELD);
      const { purifier: second } = await loadHeroRichTextRuntime();

      assert.strictEqual(first, second);
      assert.strictEqual(typeof first.sanitize, "function");
    });
  });
});
