const zlib = require("zlib");

// The tags of the woff2 table directory by their index (W3C WOFF2, 5.1); 63
// marks a tag written out in full behind the flags.
const WOFF2_KNOWN_TAGS = Object.freeze([
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
]);
const WOFF2_HEADER_BYTES = 48;
const WOFF2_FULL_TAG = 63;
// The unpacked tables of a font of at most 500 KB stay far below this; a
// directory that claims more is not unpacked at all.
const MAX_UNPACKED_BYTES = 16 * 1024 * 1024;

function tagAt(data, offset) {
  return data.toString("latin1", offset, offset + 4);
}

/**
 * The tables of a woff2 in the order of its one compressed stream, with the
 * length each takes there, and where that stream starts. Null for a
 * collection, which holds several fonts where the portal takes one.
 *
 * @param {Buffer} data - The file.
 * @returns {{tables: Array<{tag: string, length: number}>, stream: Buffer}|null}
 */
function woff2Directory(data) {
  if (data.length < WOFF2_HEADER_BYTES || tagAt(data, 4) === "ttcf") {
    return null;
  }
  const count = data.readUInt16BE(12);
  const compressedLength = data.readUInt32BE(20);

  let offset = WOFF2_HEADER_BYTES;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = data[offset++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new RangeError("UIntBase128 longer than 5 bytes");
  };

  const tables = [];
  for (let i = 0; i < count; i += 1) {
    const flags = data[offset++];
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag = WOFF2_KNOWN_TAGS[index];
    if (index === WOFF2_FULL_TAG) {
      tag = tagAt(data, offset);
      offset += 4;
    }
    const length = base128();
    // `glyf` and `loca` are transformed at version 0, every other table at
    // any other version; a transformed table is stored at its own length.
    const transformed =
      tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  return {
    tables,
    stream: data.subarray(offset, offset + compressedLength),
  };
}

/**
 * The default of the weight axis of a variable woff2 font — the instance the
 * storefront measures its fallback against (map #510). The Admin UI warns
 * with it when the default is not 400 (ECCdigital/tickets#536); browsers
 * cannot all unpack the Brotli stream of a woff2, so the backend reads it
 * once at upload.
 *
 * Null for a static font, a font without weight axis and any file it cannot
 * read: a missing value never fails an upload.
 *
 * @param {Buffer} data - A file already known to start with „wOF2“.
 * @returns {number|null} The default weight, or null.
 */
function fontDefaultWeight(data) {
  try {
    const directory = woff2Directory(data);
    if (!directory || !directory.tables.some(({ tag }) => tag === "fvar")) {
      return null;
    }

    let start = 0;
    let fvar = null;
    for (const table of directory.tables) {
      if (table.tag === "fvar") fvar = { start, length: table.length };
      start += table.length;
    }
    if (start > MAX_UNPACKED_BYTES) {
      return null;
    }

    const unpacked = zlib.brotliDecompressSync(directory.stream, {
      maxOutputLength: MAX_UNPACKED_BYTES,
    });
    const table = unpacked.subarray(fvar.start, fvar.start + fvar.length);
    const axesOffset = table.readUInt16BE(4);
    const axisCount = table.readUInt16BE(8);
    const axisSize = table.readUInt16BE(10);
    for (let i = 0; i < axisCount; i += 1) {
      const axis = axesOffset + i * axisSize;
      if (tagAt(table, axis) === "wght") {
        return table.readInt32BE(axis + 8) / 65536;
      }
    }
    return null;
  } catch {
    // A damaged file has no default to warn about; the signature alone
    // decides whether it is a font at all.
    return null;
  }
}

module.exports = { fontDefaultWeight };
