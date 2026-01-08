const mongoose = require("mongoose");

const depositSchema = new mongoose.Schema({
  mobile: String,
  amount: Number,
  utr: String,
  status: {
    type: String,
    default: "PENDING" // PENDING | APPROVED | REJECTED
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Deposit", depositSchema);
