const mongoose = require("mongoose");

const adminSettingsSchema = new mongoose.Schema({
  upiId: String,
  qrImage: String, // URL or base64
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("AdminSettings", adminSettingsSchema);
