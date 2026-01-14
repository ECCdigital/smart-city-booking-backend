const mongoose = require("mongoose");
const { eventSchemaDefinition } = require("../../schemas/eventSchema");
const { Schema } = mongoose;

const EventSchema = new Schema(eventSchemaDefinition);

EventSchema.methods.toEntity = function () {
  const { Event } = require("../../entities/event/event");
  return new Event(this.toObject());
};

// Pre-save hook to ensure date fields are in YYYY-MM-DD format
EventSchema.pre("save", function (next) {
  if (this.information) {
    if (this.information.startDate) {
      this.information.startDate = formatDateToYYYYMMDD(
        this.information.startDate,
      );
    }
    if (this.information.endDate) {
      this.information.endDate = formatDateToYYYYMMDD(this.information.endDate);
    }
  }
  next();
});

// Pre-updateOne hook to ensure date fields are in YYYY-MM-DD format
EventSchema.pre("updateOne", function (next) {
  const update = this.getUpdate();
  if (update && update.information) {
    if (update.information.startDate) {
      update.information.startDate = formatDateToYYYYMMDD(
        update.information.startDate,
      );
    }
    if (update.information.endDate) {
      update.information.endDate = formatDateToYYYYMMDD(
        update.information.endDate,
      );
    }
  }
  next();
});

/**
 * Formats a date string to YYYY-MM-DD format
 * Handles formats like YYYY-MM-DD, YYYY/MM/DD, or Date objects
 * @param {string|Date} dateStr - The date string or Date object to format
 * @returns {string} - The formatted date string in YYYY-MM-DD format
 */
function formatDateToYYYYMMDD(dateStr) {
  // If it's already in YYYY-MM-DD format, return it
  if (typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  let date;

  // Handle YYYY/MM/DD format
  if (typeof dateStr === "string" && /^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
    const parts = dateStr.split("/");
    date = new Date(
      parseInt(parts[0]),
      parseInt(parts[1]) - 1,
      parseInt(parts[2]),
    );
  } else {
    // Try to parse as a date
    date = new Date(dateStr);
  }

  // Check if date is valid
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date: ${dateStr}, keeping original value`);
    return dateStr;
  }

  // Format to YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

module.exports = mongoose.models.Event || mongoose.model("Event", EventSchema);
