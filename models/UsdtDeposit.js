const mongoose = require("mongoose");

module.exports = mongoose.model("UsdtDeposit", new mongoose.Schema({
  mobile: String,
  amount: Number,
  txid: String,
  network: String,
  status: { type: String, default: "PENDING" },
  createdAt: { type: Date, default: Date.now }
}));
