const mongoose = require("mongoose");

const withdrawSchema = new mongoose.Schema(
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

    // 🔒 Snapshot of user withdraw details at request time
    details: {
      upiId: String,

      bankName: String,
      accountHolder: String,
      accountNumber: String,
      ifsc: String,

      usdtAddress: String
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true
    },

    adminNote: {
      type: String,
      default: ""
    },

    processedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Withdraw", withdrawSchema);
