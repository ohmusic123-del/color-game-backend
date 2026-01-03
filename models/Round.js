const mongoose = require("mongoose");

module.exports = mongoose.model("Round", new mongoose.Schema({
  roundId: String,
  redPool: Number,
  greenPool: Number,
  winner: String,
  createdAt: { type: Date, default: Date.now }
}));
