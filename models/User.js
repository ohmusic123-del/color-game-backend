const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      unique: true,
      required: true
    },

    password: {
      type: String,
      required: true
    },

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
      enum: ["upi", "bank", "usdt"], // ✅ SAFE
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
  {
    timestamps: true // ✅ adds createdAt & updatedAt
  }
);

module.exports = mongoose.model("User", userSchema);
