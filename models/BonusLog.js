const mongoose = require("mongoose");

const BonusLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sourceUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    level: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    type: { type: String, default: "REFERRAL_COMMISSION" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BonusLog", BonusLogSchema);
