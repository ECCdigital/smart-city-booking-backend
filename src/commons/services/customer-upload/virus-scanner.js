const net = require("net");

/**
 * The virus scanner of customer uploads: a
 * port with one question, `scan(data)`, answered `{ clean: true }` or
 * `{ clean: false, signature }`. The implementation over the network talks
 * to clamd with INSTREAM; tests put a fake in its place with
 * `setVirusScanner`.
 *
 * Whatever keeps clamd from answering - not configured, not reachable, a
 * timeout, an answer it does not understand - throws a
 * {@link ScannerUnavailableError}: no answer means the file is refused.
 */

class ScannerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScannerUnavailableError";
  }
}

const DEFAULT_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 30_000;
// clamd reads the stream in chunks; 64 KiB stays far below its
// StreamMaxLength and keeps the socket's buffer small.
const CHUNK_BYTES = 64 * 1024;

/**
 * clamd over TCP (`CLAMD_HOST`, `CLAMD_PORT`, `CLAMD_TIMEOUT_MS`), one
 * connection per scan.
 */
class ClamdScanner {
  constructor({
    host = process.env.CLAMD_HOST,
    port = Number(process.env.CLAMD_PORT) || DEFAULT_PORT,
    timeoutMs = Number(process.env.CLAMD_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  /**
   * @param {Buffer} data
   * @returns {Promise<{clean: boolean, signature?: string}>}
   * @throws {ScannerUnavailableError}
   */
  scan(data) {
    if (!this.host) {
      return Promise.reject(
        new ScannerUnavailableError("CLAMD_HOST is not set"),
      );
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port,
      });
      const answer = [];
      let settled = false;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new ScannerUnavailableError(message));
      };

      socket.setTimeout(this.timeoutMs, () => fail("clamd timed out"));
      socket.on("error", (error) => fail(`clamd: ${error.message}`));
      socket.on("data", (chunk) => answer.push(chunk));
      socket.on("end", () => {
        if (settled) return;
        const text = Buffer.concat(answer)
          .toString("utf8")
          .replace(/\0/g, "")
          .trim();
        const result = parseClamdAnswer(text);
        if (!result) {
          return fail(`clamd answered "${text}"`);
        }
        settled = true;
        socket.end();
        resolve(result);
      });

      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
          const chunk = data.subarray(offset, offset + CHUNK_BYTES);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length, 0);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}

/**
 * Reads clamd's answer to INSTREAM: `stream: OK` or
 * `stream: <signature> FOUND`; anything else (`... ERROR`, a size limit) is
 * no answer.
 *
 * @param {string} text
 * @returns {{clean: boolean, signature?: string}|null}
 */
function parseClamdAnswer(text) {
  if (/^stream: OK$/.test(text)) {
    return { clean: true };
  }
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) {
    return { clean: false, signature: found[1] };
  }
  return null;
}

let scanner = null;

/** The scanner in use: clamd unless a test put another in its place. */
function virusScanner() {
  if (!scanner) {
    scanner = new ClamdScanner();
  }
  return scanner;
}

/**
 * Puts a scanner in place, e.g. a fake; `null` returns to clamd.
 *
 * @param {{scan: (data: Buffer) => Promise<{clean: boolean, signature?: string}>}|null} next
 */
function setVirusScanner(next) {
  scanner = next;
}

module.exports = {
  ClamdScanner,
  ScannerUnavailableError,
  parseClamdAnswer,
  setVirusScanner,
  virusScanner,
};
