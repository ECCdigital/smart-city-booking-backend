require("dotenv").config();

const dbm = require("../src/commons/utilities/database-manager");

async function migrate() {
  try {
    const db = await dbm.connect();
    const bookings = db.collection("bookings");

    // Update attachments
    const cursor1 = bookings.find({ attachments: { $exists: true } });
    while (await cursor1.hasNext()) {
      const booking = await cursor1.next();
      const updatedAttachments = Array.isArray(booking.attachments)
        ? booking.attachments.map((attachment) => {
            const { name, title: contentTitle, content, ...rest } = attachment;
            const updatedAttachment = {
              ...rest,
            };
            if (contentTitle) {
              updatedAttachment.caption = contentTitle || "";
              updatedAttachment.title = "";
            }
            if (name) {
              updatedAttachment.title = name || "";
            }
            if (content && typeof content === "object") {
              const { name: contentTitle, ...restContent } = content;
              updatedAttachment.content = {
                ...restContent,
                title: contentTitle || "",
              };
            }
            return updatedAttachment;
          })
        : [];
      await bookings.updateOne(
        { _id: booking._id },
        { $set: { attachments: updatedAttachments } },
      );
    }

    // Update bookableItems attachments
    const cursor2 = bookings.find({
      "bookableItems._bookableUsed.attachments": { $exists: true },
    });
    while (await cursor2.hasNext()) {
      const booking = await cursor2.next();
      const updatedBookableItems = booking.bookableItems.map((item) => {
        if (
          item._bookableUsed &&
          Array.isArray(item._bookableUsed.attachments)
        ) {
          item._bookableUsed.attachments = item._bookableUsed.attachments.map(
            (attachment) => {
              const { title, ...rest } = attachment;
              return {
                ...rest,
                title: "",
                caption: title || "",
              };
            },
          );
        }
        return item;
      });
      await bookings.updateOne(
        { _id: booking._id },
        { $set: { bookableItems: updatedBookableItems } },
      );
    }

    console.log("Migration completed successfully." + __filename);
  } catch (err) {
    console.error("An error occurred during migration:", err);
  } finally {
    dbm.close();
  }
}

migrate();
