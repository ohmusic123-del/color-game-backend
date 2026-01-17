const mongoose = require("mongoose");

const AdminAuditLogSchema = new mongoose.Schema(
  {
    adminUsername: { type: String, required: true },
    action: { type: String, required: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    targetDepositId: { type: mongoose.Schema.Types.ObjectId, ref: "Deposit", default: null },
    targetWithdrawId: { type: mongoose.Schema.Types.ObjectId, ref: "Withdraw", default: null },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminAuditLog", AdminAuditLogSchema);
