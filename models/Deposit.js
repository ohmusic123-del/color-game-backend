const mongoose = require("mongoose");

const depositSchema = new mongoose.Schema(
  {
    mobile: { type: String, required: true },

    amount: { type: Number, required: true },

    method: {
      type: String,
      enum: ["upi", "manual", "cashfree"],   // ✅ cashfree add
      default: "cashfree",
    },

    referenceId: { type: String },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Deposit", depositSchema);
