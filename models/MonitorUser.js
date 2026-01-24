const mongoose = require('mongoose');

const monitorUserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    displayName: String,
    active: { type: Boolean, default: true },
    totalLogins: { type: Number, default: 0 },
    lastLogin: Date,
    createdAt: { type: Date, default: Date.now },
    createdBy: String
});

module.exports = mongoose.model('MonitorUser', monitorUserSchema);
