const mongoose = require("mongoose");

const betSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      index: true
    },

    roundId: {
      type: String,
      required: true,
      index: true
    },

    color: {
      type: String,
      enum: ["red", "green"],
      required: true
    },

    amount: {
      type: Number,
      required: true,
      min: 1
    },

    status: {
      type: String,
      enum: ["PENDING", "WON", "LOST"],
      default: "PENDING"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bet", betSchema);
