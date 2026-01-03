const mongoose = require("mongoose");

const betSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  color: String,
  amount: Number,
  roundId: Number,
  result: String,
  payout: Number
});

module.exports = mongoose.model("Bet", betSchema);
