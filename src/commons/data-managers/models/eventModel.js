const mongoose = require("mongoose");
const { Event } = require("../../entities/event");
const { Schema } = mongoose;

const EventSchema = new Schema(Event.schema);

module.exports = mongoose.models.Event || mongoose.model("Event", EventSchema);
