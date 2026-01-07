const mongoose = require("mongoose");

const betSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true
  },

  color: {
    type: String,
    enum: ["red", "green"],
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  roundId: {
    type: String,
    required: true
  },

  // ✅ NEW: BET STATUS
  status: {
    type: String,
    enum: ["PENDING", "WON", "LOST"],
    default: "PENDING"
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Bet", betSchema);
