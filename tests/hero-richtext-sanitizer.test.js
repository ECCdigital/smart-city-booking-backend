const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");

const {
  HERO_RICHTEXT_ALLOWLIST,
  HERO_RICHTEXT_MAX_RAW_LENGTH,
  HERO_RICHTEXT_MAX_SANITIZED_LENGTH,
  loadHeroRichTextPurifier,
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
      ]);
      assert.deepStrictEqual(HERO_RICHTEXT_ALLOWLIST.ALLOWED_ATTR, [
        "href",
        "target",
        "rel",
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
        "ALLOWED_ATTR",
        "ALLOWED_TAGS",
        "ALLOWED_URI_REGEXP",
        "ALLOW_ARIA_ATTR",
        "ALLOW_DATA_ATTR",
        "KEEP_CONTENT",
      ]);
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
      const raw = "<span>".repeat(3000) + "<p>" + text + "</p>";
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
      const first = await loadHeroRichTextPurifier();
      await sanitizeHeroRichText("<p>a</p>", FIELD);
      const second = await loadHeroRichTextPurifier();

      assert.strictEqual(first, second);
      assert.strictEqual(typeof first.sanitize, "function");
    });
  });
});
