const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    password: {
      type: String,
      required: true
    },

    /* ======================
       WALLET
    ====================== */
    wallet: {
      type: Number,
      default: 0
    },

    bonus: {
      type: Number,
      default: 100
    },

    totalWagered: {
      type: Number,
      default: 0
    },

    /* ======================
       DEPOSIT INFO
    ====================== */
    deposited: {
      type: Boolean,
      default: false
    },

    depositAmount: {
      type: Number,
      default: 0
    },

    /* ======================
       WITHDRAW DETAILS
    ====================== */
    withdrawMethod: {
      type: String,
      enum: ["upi", "bank", "usdt"],
      default: null
    },

    withdrawDetails: {
      upiId: String,

      bankName: String,
      accountHolder: String,
      accountNumber: String,
      ifsc: String,

      usdtAddress: String
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
