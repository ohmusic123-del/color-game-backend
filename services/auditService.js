const AdminAuditLog = require("../models/AdminAuditLog");

async function logAdminAction({
  adminUsername,
  action,
  targetUserId = null,
  targetDepositId = null,
  targetWithdrawId = null,
  meta = {},
}) {
  try {
    await AdminAuditLog.create({
      adminUsername,
      action,
      targetUserId,
      targetDepositId,
      targetWithdrawId,
      meta,
    });
  } catch (e) {
    // Do not break main API flow if audit fails
    console.error("Audit log failed:", e.message);
  }
}

module.exports = { logAdminAction };
