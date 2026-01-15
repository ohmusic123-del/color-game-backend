const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      unique: true
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
    totalWagered: {
      type: Number,
      default: 0
    },
    withdrawMethod: {
      type: String,
      enum: ["upi", "bank", "usdt"],
      default: "upi"
    },
    withdrawDetails: {
      upiId: String,
      bankName: String,
      accountHolder: String,
      accountNumber: String,
      ifsc: String,
      usdtAddress: String
    },
    // ✅ REFERRAL FIELDS
    referralCode: {
      type: String,
      unique: true,
      sparse: true
    },
    referredBy: {
      type: String,
      default: null
    },
    referralEarnings: {
      type: Number,
      default: 0
    },
    totalReferrals: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
