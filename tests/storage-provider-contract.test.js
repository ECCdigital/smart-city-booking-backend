const assert = require("assert");
const { Readable } = require("node:stream");

const {
  NextcloudStorageProvider,
} = require("../src/commons/services/storage/nextcloud-storage-provider");
const {
  S3StorageProvider,
} = require("../src/commons/services/storage/s3-storage-provider");
const {
  StorageError,
  StorageNotFoundError,
} = require("../src/errors/StorageError");

const KEY = "tenant1/media/media-1/original.png";
const BYTES = Buffer.from("the original bytes");

function webdavError(status) {
  return Object.assign(new Error(`webdav ${status}`), { status });
}

function s3Error(httpStatusCode, name) {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode },
  });
}

function fakeWebdavClient(store) {
  return {
    createdDirectories: [],
    async createDirectory(path) {
      this.createdDirectories.push(path);
    },
    async putFileContents(path, data, options = {}) {
      store.set(path, {
        data: Buffer.from(data),
        contentType: options.headers?.["Content-Type"] || null,
      });
      return true;
    },
    createReadStream(path) {
      const entry = store.get(path);
      if (!entry) {
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.emit("error", webdavError(404)));
        return stream;
      }
      return Readable.from([entry.data]);
    },
    async getFileContents(path) {
      const entry = store.get(path);
      if (!entry) throw webdavError(404);
      return entry.data;
    },
    async stat(path) {
      const entry = store.get(path);
      if (!entry) throw webdavError(404);
      return {
        size: entry.data.length,
        mime: entry.contentType,
        etag: "etag-1",
        lastmod: "Thu, 01 Jan 1970 00:00:00 GMT",
      };
    },
    async deleteFile(path) {
      if (!store.has(path)) throw webdavError(404);
      store.delete(path);
    },
  };
}

function brokenWebdavClient(status = 500) {
  const fail = async () => {
    throw webdavError(status);
  };
  return {
    createDirectory: fail,
    putFileContents: fail,
    getFileContents: fail,
    stat: fail,
    deleteFile: fail,
    createReadStream() {
      throw webdavError(status);
    },
  };
}

function fakeS3Client(store) {
  return {
    async send(command) {
      const input = command.input;

      switch (command.constructor.name) {
        case "PutObjectCommand":
          store.set(input.Key, {
            data: Buffer.from(input.Body),
            contentType: input.ContentType || null,
          });
          return {};
        case "GetObjectCommand": {
          const entry = store.get(input.Key);
          if (!entry) throw s3Error(404, "NoSuchKey");
          return {
            Body: Readable.from([entry.data]),
            ContentLength: entry.data.length,
            ContentType: entry.contentType,
          };
        }
        case "HeadObjectCommand": {
          const entry = store.get(input.Key);
          if (!entry) throw s3Error(404, "NotFound");
          return {
            ContentLength: entry.data.length,
            ContentType: entry.contentType,
            ETag: '"etag-1"',
            LastModified: new Date(0),
          };
        }
        case "DeleteObjectCommand":
          store.delete(input.Key);
          return {};
        case "DeleteObjectsCommand":
          for (const object of input.Delete.Objects) {
            store.delete(object.Key);
          }
          return {};
        default:
          throw new Error(`Unexpected command ${command.constructor.name}`);
      }
    },
  };
}

function brokenS3Client(status = 500) {
  return {
    async send() {
      throw s3Error(status, "InternalError");
    },
  };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const IMPLEMENTATIONS = [
  {
    name: "nextcloud",
    create() {
      const store = new Map();
      return {
        provider: new NextcloudStorageProvider({
          client: fakeWebdavClient(store),
        }),
        store,
      };
    },
    createBroken() {
      return new NextcloudStorageProvider({ client: brokenWebdavClient() });
    },
    createBrokenWith(status) {
      return new NextcloudStorageProvider({
        client: brokenWebdavClient(status),
      });
    },
  },
  {
    name: "s3",
    create() {
      const store = new Map();
      return {
        provider: new S3StorageProvider({
          client: fakeS3Client(store),
          bucket: "test-bucket",
        }),
        store,
      };
    },
    createBroken() {
      return new S3StorageProvider({
        client: brokenS3Client(),
        bucket: "test-bucket",
      });
    },
    createBrokenWith(status) {
      return new S3StorageProvider({
        client: brokenS3Client(status),
        bucket: "test-bucket",
      });
    },
  },
];

for (const implementation of IMPLEMENTATIONS) {
  describe(`storage provider contract: ${implementation.name}`, function () {
    let provider;

    beforeEach(function () {
      provider = implementation.create().provider;
    });

    it("reports the provider name persisted on a medium", function () {
      assert.strictEqual(provider.name, implementation.name);
    });

    it("stores bytes and reports key and size", async function () {
      const result = await provider.put({
        key: KEY,
        data: BYTES,
        contentType: "image/png",
      });

      assert.strictEqual(result.key, KEY);
      assert.strictEqual(result.size, BYTES.length);
    });

    it("returns the stored bytes as a buffer", async function () {
      await provider.put({ key: KEY, data: BYTES, contentType: "image/png" });

      const buffer = await provider.getBuffer({ key: KEY });

      assert.ok(Buffer.isBuffer(buffer));
      assert.strictEqual(buffer.toString(), BYTES.toString());
    });

    it("streams the stored bytes", async function () {
      await provider.put({ key: KEY, data: BYTES, contentType: "image/png" });

      const stream = await provider.getStream({ key: KEY });

      assert.strictEqual((await readAll(stream)).toString(), BYTES.toString());
    });

    it("reports size and content type of a stored key", async function () {
      await provider.put({ key: KEY, data: BYTES, contentType: "image/png" });

      const stat = await provider.stat({ key: KEY });

      assert.strictEqual(stat.size, BYTES.length);
      assert.strictEqual(stat.mime, "image/png");
    });

    it("reports a missing key as a 404 storage error when reading", async function () {
      await assert.rejects(
        () => provider.getBuffer({ key: "tenant1/media/nope/original.png" }),
        (error) => {
          assert.ok(error instanceof StorageNotFoundError);
          assert.strictEqual(error.statusCode, 404);
          return true;
        },
      );
    });

    it("reports a missing key as a 404 storage error when stating", async function () {
      await assert.rejects(
        () => provider.stat({ key: "tenant1/media/nope/original.png" }),
        (error) => error instanceof StorageNotFoundError,
      );
    });

    it("removes stored bytes", async function () {
      await provider.put({ key: KEY, data: BYTES, contentType: "image/png" });
      await provider.delete({ key: KEY });

      await assert.rejects(
        () => provider.getBuffer({ key: KEY }),
        (error) => error instanceof StorageNotFoundError,
      );
    });

    it("treats deleting a missing key as done", async function () {
      await provider.delete({ key: "tenant1/media/nope/original.png" });
    });

    it("removes several keys at once", async function () {
      const otherKey = "tenant1/media/media-1/thumb.webp";
      await provider.put({ key: KEY, data: BYTES, contentType: "image/png" });
      await provider.put({
        key: otherKey,
        data: BYTES,
        contentType: "image/webp",
      });

      await provider.deleteMany({ keys: [KEY, otherKey] });

      await assert.rejects(
        () => provider.getBuffer({ key: KEY }),
        (error) => error instanceof StorageNotFoundError,
      );
      await assert.rejects(
        () => provider.getBuffer({ key: otherKey }),
        (error) => error instanceof StorageNotFoundError,
      );
    });

    it("normalises backend failures onto StorageError", async function () {
      const broken = implementation.createBroken();

      await assert.rejects(
        () => broken.put({ key: KEY, data: BYTES, contentType: "image/png" }),
        (error) => {
          assert.ok(error instanceof StorageError);
          assert.strictEqual(error.isStorageError, true);
          assert.strictEqual(error.code, "storage_put_failed");
          return true;
        },
      );
    });

    it("never leaks the backend's own status onto the API response", async function () {
      const broken = implementation.createBrokenWith(401);

      await assert.rejects(
        () => broken.put({ key: KEY, data: BYTES, contentType: "image/png" }),
        (error) => {
          assert.strictEqual(error.statusCode, 503);
          assert.strictEqual(error.params.providerStatus, 401);
          return true;
        },
      );
    });
  });
}
