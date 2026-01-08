const mongoose = require("mongoose");

const roundSchema = new mongoose.Schema(
  {
    roundId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    redPool: {
      type: Number,
      required: true,
      default: 0
    },

    greenPool: {
      type: Number,
      required: true,
      default: 0
    },

    winner: {
      type: String,
      enum: ["red", "green"],
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Round", roundSchema);
