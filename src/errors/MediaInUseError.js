const { ConflictError } = require("./BaseError");

/**
 * Raised when a medium that is still referenced somewhere should be deleted.
 *
 * Its body is the usage proof itself and nothing else — byte-identical to what
 * `GET /media/:id/usage` answers (§4.7 of the media spec), so the admin UI
 * renders the same list no matter which of the two calls produced it.
 */
class MediaInUseError extends ConflictError {
  /**
   * @param {Array<{type: string, id: string|null, title: string}>} usage -
   *   The usage sites that block the deletion.
   */
  constructor(usage = []) {
    super("media_in_use", { usage });
    this.name = "MediaInUseError";
    this.usage = usage;
  }

  toJSON() {
    return this.usage;
  }
}

module.exports = { MediaInUseError };
