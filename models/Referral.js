const mongoose = require("mongoose");

const referralSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    referredUserId: {
      type: String,
      required: true
    },
    level: {
      type: Number,
      required: true,
      min: 1,
      max: 6
    },
    commission: {
      type: Number,
      required: true
    },
    type: {
      type: String,
      enum: ["DEPOSIT", "BET"],
      required: true
    },
    amount: {
      type: Number,
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Referral", referralSchema);
