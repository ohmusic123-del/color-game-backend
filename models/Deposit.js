const mongoose = require("mongoose");

const depositSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      index: true
    },

    amount: {
      type: Number,
      required: true
    },

    method: {
      type: String,
      enum: ["upi", "bank", "usdt"],
      required: true
    },

    // Optional reference details
    referenceId: {
      type: String
    },

    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "SUCCESS"
    },

    adminNote: {
      type: String,
      default: ""
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Deposit", depositSchema);
