const mongoose = require('mongoose');

const monitorActivitySchema = new mongoose.Schema({
    username: String,
    action: String,
    ipAddress: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MonitorActivity', monitorActivitySchema);
