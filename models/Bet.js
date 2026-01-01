const mongoose = require("mongoose");

const betSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  roundId: Number,
  color: String,
  amount: Number,
  result: {
    type: String,
    enum: ["WIN", "LOSS"],
    default: null
  },
  payout: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Bet", betSchema);
