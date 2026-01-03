const mongoose = require("mongoose");

module.exports = mongoose.model("Bet", new mongoose.Schema({
  mobile: String,
  color: String,
  amount: Number,
  roundId: String,
  createdAt: { type: Date, default: Date.now }
}));
