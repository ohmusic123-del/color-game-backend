const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  balance: {
    type: Number,
    default: 1000
  }
});

module.exports = mongoose.model("Wallet", walletSchema);
