const mongoose = require("mongoose");
const { eventSchemaDefinition } = require("../../schemas/eventSchema");
const { Schema } = mongoose;

const EventSchema = new Schema(eventSchemaDefinition);

EventSchema.methods.toEntity = function () {
  const { Event } = require("../../entities/event/event");
  return new Event(this.toObject());
};

module.exports = mongoose.models.Event || mongoose.model("Event", EventSchema);
