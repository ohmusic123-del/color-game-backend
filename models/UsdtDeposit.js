const mongoose = require("mongoose");

const usdtDepositSchema = new mongoose.Schema(
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

    network: {
      type: String,
      enum: ["TRC20"],
      default: "TRC20"
    },

    txHash: {
      type: String,
      required: true,
      unique: true
    },

    fromAddress: {
      type: String
    },

    toAddress: {
      type: String,
      required: true
    },

    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "FAILED"],
      default: "PENDING"
    },

    confirmations: {
      type: Number,
      default: 0
    },

    adminNote: {
      type: String,
      default: ""
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("UsdtDeposit", usdtDepositSchema);
