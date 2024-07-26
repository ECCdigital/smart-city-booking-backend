require("dotenv").config();

const dbm = require("../src/commons/utilities/database-manager");

async function migrate() {
  try {
    const db = await dbm.connect();
    const bookables = db.collection("bookables");

    //Update attachments
    const cursor1 = bookables.find({ attachments: { $exists: true } });
    while (await cursor1.hasNext()) {
      const bookable = await cursor1.next();
      const updatedAttachments = Array.isArray(bookable.attachments)
        ? bookable.attachments.map((attachment) => {
            const { title: contentTitle, ...rest } = attachment;
            return {
              ...rest,
              caption: contentTitle || "",
              title: "Download",
            };
          })
        : [];
      await bookables.updateOne(
        { _id: bookable._id },
        { $set: { attachments: updatedAttachments } },
      );
    }
    console.log("Migration completed successfully." + __filename);
  } catch (err) {
    console.error("An error occurred during migration.", err);
  } finally {
    await dbm.close();
  }
}

migrate();
