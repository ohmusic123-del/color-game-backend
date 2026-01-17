const AdminAuditLog = require("../models/AdminAuditLog");

async function logAdminAction({ adminUsername, action, meta = {} }) {
  try {
    await AdminAuditLog.create({
      adminUsername: adminUsername || "unknown",
      action,
      meta,
    });
  } catch (e) {
    // Do not block main flow if audit fails
    console.error("Audit log error:", e.message);
  }
}

module.exports = { logAdminAction };
