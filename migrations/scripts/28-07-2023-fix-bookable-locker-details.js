module.exports = {
  name: "28-07-2023-fix-bookable-locker-details",

  up: async function (mongoose) {
    const Bookable = mongoose.model("Bookable");
    
    const bookables = await Bookable.find({}).lean();
    
    let updatedCount = 0;
    
    for (const bookable of bookables) {
      if (Array.isArray(bookable.lockerDetails)) {
        console.log(`Fixing lockerDetails for bookable ${bookable.id}`);
        
        if (bookable.lockerDetails.length > 0) {
          const newLockerDetails = bookable.lockerDetails[0];
          
          await Bookable.updateOne(
            { _id: bookable._id },
            { $set: { lockerDetails: newLockerDetails } }
          );
          
          updatedCount++;
        } else {
          await Bookable.updateOne(
            { _id: bookable._id },
            { $set: { lockerDetails: { active: false, units: [] } } }
          );
          
          updatedCount++;
        }
      }
    }
  },

  down: async function (mongoose) {
    console.log("This migration cannot be reverted as the original array structure is not preserved");
  },
};