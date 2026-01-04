const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  mobile: { type: String, unique: true },
  password: String,

  wallet: { type: Number, default: 0 },

  bonus: { type: Number, default: 100 },
  totalWagered: { type: Number, default: 0 },

  deposited: { type: Boolean, default: false },
  depositAmount: { type: Number, default: 0 }
});

module.exports = mongoose.model("User", userSchema);
