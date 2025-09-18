module.exports = {
  name: "14-06-2023-convert-event-dates-to-yyyy-mm-dd-format",

  up: async function (mongoose) {
    const Event = mongoose.model("Event");
    const events = await Event.find({});
    
    for (const event of events) {
      let updated = false;
      
      if (event.information) {
        if (event.information.startDate) {
          const formattedStartDate = formatDateToYYYYMMDD(event.information.startDate);
          if (formattedStartDate !== event.information.startDate) {
            event.information.startDate = formattedStartDate;
            updated = true;
          }
        }
        
        if (event.information.endDate) {
          const formattedEndDate = formatDateToYYYYMMDD(event.information.endDate);
          if (formattedEndDate !== event.information.endDate) {
            event.information.endDate = formattedEndDate;
            updated = true;
          }
        }
        
        if (updated) {
          await Event.updateOne(
            { _id: event._id },
            { $set: { information: event.information } }
          );
          console.log(`Updated event ${event.id}: startDate=${event.information.startDate}, endDate=${event.information.endDate}`);
        }
      }
    }
    
    /**
     * Formats a date string to YYYY-MM-DD format
     * Handles formats like YYYY-MM-DD, YYYY/MM/DD, or Date objects
     * @param {string|Date} dateStr - The date string or Date object to format
     * @returns {string} - The formatted date string in YYYY-MM-DD format
     */
    function formatDateToYYYYMMDD(dateStr) {
      if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
      }
      
      let date;
      
      if (typeof dateStr === 'string' && /^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('/');
        date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      } else {
        date = new Date(dateStr);
      }
      
      if (isNaN(date.getTime())) {
        console.warn(`Invalid date: ${dateStr}, keeping original value`);
        return dateStr;
      }
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      return `${year}-${month}-${day}`;
    }
  },

  down: async function (mongoose) {
    console.log("This migration cannot be reverted as the original date formats are not stored");
  },
};