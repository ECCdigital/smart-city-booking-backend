const { expect } = require("chai");
const {
  NextcloudManager,
  NextcloudError,
} = require("../../src/commons/data-managers/file-manager");

describe("NextcloudManager.deleteFile — path-traversal guard", () => {
  const rejectsTraversal = async (path) => {
    let error;
    try {
      await NextcloudManager.deleteFile("kielregion", path);
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(NextcloudError);
    expect(error.message).to.equal("Invalid file path");
  };

  it("rejects a path with a parent-directory segment", async () => {
    await rejectsTraversal("/public/logos/../../other/secret.pdf");
  });

  it("rejects a relative parent-directory path", async () => {
    await rejectsTraversal("../escape.png");
  });

  it("rejects even after leading slashes are stripped", async () => {
    await rejectsTraversal("///../escape.png");
  });
});
