const mongoose = require("mongoose");

const roundSchema = new mongoose.Schema({
  roundId: Number,
  startTime: Date,
  endTime: Date,
  result: {
    type: String,
    enum: ["RED", "GREEN", "VIOLET"],
    default: null
  },
  status: {
    type: String,
    enum: ["OPEN", "CLOSED"],
    default: "OPEN"
  }
});

module.exports = mongoose.model("Round", roundSchema);
