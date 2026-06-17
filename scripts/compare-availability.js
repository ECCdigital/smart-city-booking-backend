#!/usr/bin/env node

/**
 * Compare availability responses from V1 and V2 endpoints.
 *
 * Usage:
 *   node scripts/compare-availability.js \
 *     --tenant my-tenant \
 *     --bookable abc123 \
 *     --start 2026-06-17 \
 *     --end 2026-06-24 \
 *     --amount 1
 *
 *   npm run compare:availability -- --tenant my-tenant --bookable abc123
 */

const axios = require("axios");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

function formatTimestamp(ms) {
  if (ms == null || Number.isNaN(Number(ms))) {
    return String(ms);
  }

  return new Date(Number(ms)).toISOString().replace("T", " ").slice(0, 19);
}

function normalizeResponse(data) {
  if (!data) {
    return { title: "", availability: [] };
  }

  if (Array.isArray(data)) {
    return {
      title: "",
      availability: data.map((segment) => ({
        timeBegin: Number(segment.timeBegin),
        timeEnd: Number(segment.timeEnd),
        available: Boolean(segment.available),
      })),
    };
  }

  return {
    title: data.title ?? "",
    availability: (data.availability ?? []).map((segment) => ({
      timeBegin: Number(segment.timeBegin),
      timeEnd: Number(segment.timeEnd),
      available: Boolean(segment.available),
    })),
    metrics: data._metrics ?? null,
  };
}

function segmentKey(segment) {
  return `${segment.timeBegin}|${segment.timeEnd}|${segment.available}`;
}

function compareAvailability(v1Segments, v2Segments) {
  const v2Map = new Map(v2Segments.map((s) => [segmentKey(s), s]));

  const onlyV1 = v1Segments.filter((s) => !v2Map.has(segmentKey(s)));
  const onlyV2 = v2Segments.filter(
    (s) => !v1Segments.some((v1) => segmentKey(v1) === segmentKey(s)),
  );
  const matching = v1Segments.filter((s) => v2Map.has(segmentKey(s)));

  return {
    match: onlyV1.length === 0 && onlyV2.length === 0,
    matchingCount: matching.length,
    onlyV1,
    onlyV2,
  };
}

function printSegments(label, segments, limit = 20) {
  console.log(`\n${label} (${segments.length} segments):`);

  if (segments.length === 0) {
    console.log("  (none)");
    return;
  }

  const shown = segments.slice(0, limit);
  for (const segment of shown) {
    const status = segment.available ? "available  " : "unavailable";
    console.log(
      `  ${status}  ${formatTimestamp(segment.timeBegin)} -> ${formatTimestamp(segment.timeEnd)}`,
    );
  }

  if (segments.length > limit) {
    console.log(`  ... and ${segments.length - limit} more`);
  }
}

function printDiffSegments(label, segments, limit = 10) {
  if (segments.length === 0) {
    return;
  }

  console.log(`\n${label} (${segments.length}):`);
  const shown = segments.slice(0, limit);
  for (const segment of shown) {
    const status = segment.available ? "available  " : "unavailable";
    console.log(
      `  ${status}  ${formatTimestamp(segment.timeBegin)} -> ${formatTimestamp(segment.timeEnd)}`,
    );
  }

  if (segments.length > limit) {
    console.log(`  ... and ${segments.length - limit} more`);
  }
}

async function fetchAvailability(url, params) {
  const startedAt = Date.now();
  const response = await axios.get(url, { params, validateStatus: () => true });
  return {
    status: response.status,
    durationMs: Date.now() - startedAt,
    data: response.data,
    url,
  };
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("tenant", {
      alias: "t",
      type: "string",
      demandOption: true,
      describe: "Tenant ID",
    })
    .option("bookable", {
      alias: "b",
      type: "string",
      demandOption: true,
      describe: "Bookable ID",
    })
    .option("start", {
      alias: "s",
      type: "string",
      describe: "Start date (YYYY-MM-DD)",
    })
    .option("end", {
      alias: "e",
      type: "string",
      describe: "End date (YYYY-MM-DD)",
    })
    .option("amount", {
      alias: "a",
      type: "number",
      default: 1,
      describe: "Requested amount",
    })
    .option("base-url", {
      type: "string",
      default:
        process.env.API_BASE_URL ||
        `http://localhost:${process.env.PORT || 8082}`,
      describe: "API base URL without trailing slash",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      describe: "Print full availability lists",
    })
    .help()
    .alias("help", "h")
    .example(
      "$0 -t my-tenant -b room-1 -s 2026-06-17 -e 2026-06-24 -a 2",
      "Compare availability for 2 units in a date range",
    )
    .parse();

  const params = { amount: argv.amount };
  if (argv.start) params.startDate = argv.start;
  if (argv.end) params.endDate = argv.end;

  const baseUrl = argv.baseUrl.replace(/\/$/, "");
  const v1Url = `${baseUrl}/api/${encodeURIComponent(argv.tenant)}/bookables/${encodeURIComponent(argv.bookable)}/availability`;
  const v2Url = `${baseUrl}/api/${encodeURIComponent(argv.tenant)}/bookables/${encodeURIComponent(argv.bookable)}/availability/v2`;

  console.log("Comparing availability endpoints");
  console.log(`  Base URL : ${baseUrl}`);
  console.log(`  Tenant   : ${argv.tenant}`);
  console.log(`  Bookable : ${argv.bookable}`);
  console.log(`  Amount   : ${argv.amount}`);
  console.log(
    `  Range    : ${argv.start ?? "(default)"} -> ${argv.end ?? "(default)"}`,
  );

  const [v1Result, v2Result] = await Promise.all([
    fetchAvailability(v1Url, params),
    fetchAvailability(v2Url, params),
  ]);

  console.log("\n--- HTTP ---");
  console.log(`V1: ${v1Result.status}  ${v1Url}  (${v1Result.durationMs} ms)`);
  console.log(`V2: ${v2Result.status}  ${v2Url}  (${v2Result.durationMs} ms)`);

  if (v1Result.status !== 200 || v2Result.status !== 200) {
    console.error("\nRequest failed.");
    if (v1Result.status !== 200) {
      console.error(`V1 (${v1Result.status}):`, JSON.stringify(v1Result.data, null, 2));
    }
    if (v2Result.status !== 200) {
      console.error(`V2 (${v2Result.status}):`, JSON.stringify(v2Result.data, null, 2));
    }
    process.exit(1);
  }

  const v1 = normalizeResponse(v1Result.data);
  const v2 = normalizeResponse(v2Result.data);
  const diff = compareAvailability(v1.availability, v2.availability);

  console.log("\n--- Summary ---");
  console.log(`Title V1 : ${v1.title || "(empty)"}`);
  console.log(`Title V2 : ${v2.title || "(empty)"}`);
  console.log(`Segments V1: ${v1.availability.length}`);
  console.log(`Segments V2: ${v2.availability.length}`);
  console.log(`Matching   : ${diff.matchingCount}`);
  console.log(`Identical  : ${diff.match ? "yes" : "no"}`);

  if (v2.metrics) {
    console.log("\n--- V2 server metrics ---");
    console.log(`  durationMs    : ${v2.metrics.durationMs}`);
    console.log(`  dbQueryCount  : ${v2.metrics.dbQueryCount}`);
    console.log(`  segmentChecks : ${v2.metrics.segmentChecks}`);
  }

  console.log("\n--- Client timing ---");
  console.log(`  V1 request: ${v1Result.durationMs} ms`);
  console.log(`  V2 request: ${v2Result.durationMs} ms`);
  console.log(
    `  Delta     : ${v1Result.durationMs - v2Result.durationMs} ms (positive = V2 faster)`,
  );

  if (!diff.match) {
    printDiffSegments("Only in V1", diff.onlyV1);
    printDiffSegments("Only in V2", diff.onlyV2);
  } else {
    console.log("\nAvailability segments are identical.");
  }

  if (argv.verbose) {
    printSegments("V1 availability", v1.availability, 1000);
    printSegments("V2 availability", v2.availability, 1000);
  }

  process.exit(diff.match ? 0 : 2);
}

main().catch((error) => {
  if (error.response) {
    console.error(
      `HTTP ${error.response.status}:`,
      JSON.stringify(error.response.data, null, 2),
    );
  } else if (error.code === "ECONNREFUSED") {
    console.error("Could not connect to API. Is the server running?");
    console.error("Set --base-url or API_BASE_URL if needed.");
  } else {
    console.error(error.message);
  }
  process.exit(1);
});
