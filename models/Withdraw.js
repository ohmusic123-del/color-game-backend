const mongoose = require("mongoose");

module.exports = mongoose.model("Withdraw", new mongoose.Schema({
  mobile: String,
  amount: Number,
  method: String,
  status: { type: String, default: "PENDING" },
  createdAt: { type: Date, default: Date.now }
}));
