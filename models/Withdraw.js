const mongoose = require("mongoose");

const withdrawSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  method: {
    type: String, // "upi" | "bank" | "usdt"
    required: true
  },

  // ✅ SNAPSHOT OF DETAILS (IMPORTANT)
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
    default: "PENDING"
  },

  adminNote: {
    type: String,
    default: ""
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  processedAt: {
    type: Date
  }
});

module.exports = mongoose.model("Withdraw", withdrawSchema);
