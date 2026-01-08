const mongoose = require("mongoose");

const adminSettingsSchema = new mongoose.Schema(
  {
    /* =========================
       GAME SETTINGS
    ========================= */
    roundDuration: {
      type: Number, // seconds
      default: 30
    },

    houseEdge: {
      type: Number, // percentage (2% = 0.02)
      default: 0.02
    },

    /* =========================
       BET SETTINGS
    ========================= */
    minBet: {
      type: Number,
      default: 10
    },

    maxBet: {
      type: Number,
      default: 10000
    },

    /* =========================
       DEPOSIT SETTINGS
    ========================= */
    minDeposit: {
      type: Number,
      default: 100
    },

    usdtWalletAddress: {
      type: String,
      default: ""
    },

    /* =========================
       WITHDRAW SETTINGS
    ========================= */
    minWithdraw: {
      type: Number,
      default: 100
    },

    withdrawFeePercent: {
      type: Number,
      default: 0
    },

    /* =========================
       PLATFORM FLAGS
    ========================= */
    maintenanceMode: {
      type: Boolean,
      default: false
    },

    allowRegistration: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminSettings", adminSettingsSchema);
