const { StorageProvider } = require("./storage-provider");

// Hard limit of the S3 DeleteObjects API.
const DELETE_BATCH_SIZE = 1000;

/**
 * Creates the S3 client from the environment configuration. MinIO and other
 * S3-compatible services are pure configuration (`endpoint` +
 * `forcePathStyle`); retries are left to the AWS SDK.
 *
 * @returns {Object} An S3Client.
 */
function createS3Client() {
  const { S3Client } = require("@aws-sdk/client-s3");

  const hasStaticCredentials =
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY;

  return new S3Client({
    region: process.env.S3_REGION,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    ...(hasStaticCredentials
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

/**
 * Reads an S3 response body into a Buffer, supporting both the SDK's byte
 * helper and plain Node streams.
 *
 * @param {Object} body - The `Body` of a GetObject response.
 * @returns {Promise<Buffer>}
 */
async function bodyToBuffer(body) {
  if (typeof body?.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * S3 implementation of the storage provider contract (AWS SDK v3).
 * Downloads always run through the backend — there is no presigned-URL path,
 * because every read is permission-checked.
 */
class S3StorageProvider extends StorageProvider {
  /**
   * @param {Object} [options]
   * @param {Object} [options.client] - Pre-built S3 client (used by tests).
   * @param {string} [options.bucket] - Target bucket, defaults to `S3_BUCKET`.
   */
  constructor({ client, bucket } = {}) {
    super();
    this._client = client || null;
    this._bucket = bucket || process.env.S3_BUCKET;
  }

  get name() {
    return "s3";
  }

  _getClient() {
    if (!this._client) {
      this._client = createS3Client();
    }
    return this._client;
  }

  _isMissing(error) {
    return (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NotFound" ||
      error?.name === "NoSuchKey"
    );
  }

  async put({ key, data, contentType }) {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");

    try {
      await this._getClient().send(
        new PutObjectCommand({
          Bucket: this._bucket,
          Key: key,
          Body: data,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );

      return { key, size: data?.length ?? 0 };
    } catch (error) {
      throw this._toStorageError(error, "storage_put_failed", key);
    }
  }

  async getStream({ key }) {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");

    try {
      const response = await this._getClient().send(
        new GetObjectCommand({ Bucket: this._bucket, Key: key }),
      );
      return response.Body;
    } catch (error) {
      throw this._toStorageError(error, "storage_get_stream_failed", key);
    }
  }

  async getBuffer({ key }) {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");

    try {
      const response = await this._getClient().send(
        new GetObjectCommand({ Bucket: this._bucket, Key: key }),
      );
      return await bodyToBuffer(response.Body);
    } catch (error) {
      throw this._toStorageError(error, "storage_get_buffer_failed", key);
    }
  }

  async stat({ key }) {
    const { HeadObjectCommand } = require("@aws-sdk/client-s3");

    try {
      const response = await this._getClient().send(
        new HeadObjectCommand({ Bucket: this._bucket, Key: key }),
      );

      return {
        size: response?.ContentLength ?? null,
        mime: response?.ContentType ?? null,
        etag: response?.ETag ?? null,
        lastmod: response?.LastModified
          ? new Date(response.LastModified).toUTCString()
          : null,
      };
    } catch (error) {
      throw this._toStorageError(error, "storage_stat_failed", key);
    }
  }

  async delete({ key }) {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");

    try {
      await this._getClient().send(
        new DeleteObjectCommand({ Bucket: this._bucket, Key: key }),
      );
    } catch (error) {
      this._throwUnlessMissing(error, "storage_delete_failed", key);
    }
  }

  async deleteMany({ keys }) {
    const { DeleteObjectsCommand } = require("@aws-sdk/client-s3");
    const allKeys = (keys || []).filter(Boolean);

    for (let i = 0; i < allKeys.length; i += DELETE_BATCH_SIZE) {
      const batch = allKeys.slice(i, i + DELETE_BATCH_SIZE);

      try {
        await this._getClient().send(
          new DeleteObjectsCommand({
            Bucket: this._bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      } catch (error) {
        throw this._toStorageError(
          error,
          "storage_delete_many_failed",
          batch[0],
        );
      }
    }
  }
}

module.exports = { S3StorageProvider };
