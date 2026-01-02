const mongoose = require("mongoose");

const betSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  color: String,
  amount: Number,
  result: String,
  payout: Number
}, { timestamps: true });

module.exports = mongoose.model("Bet", betSchema);
