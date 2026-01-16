const mongoose = require("mongoose");

const adminSettingsSchema = new mongoose.Schema(
    {
        /* =========================
           GAME SETTINGS
        ========================= */
        roundDuration: {
            type: Number, // seconds
            default: 60
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
            default: 1
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

        upiId: {
            type: String,
            default: ""
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
           BONUS SETTINGS
        ========================= */
        registrationBonus: {
            type: Number,
            default: 100
        },

        welcomeBonus: {
            type: Number,
            default: 100
        },

        firstDepositBonusPercent: {
            type: Number,
            default: 100
        },

        /* =========================
           REFERRAL SETTINGS
        ========================= */
        referralLevels: {
            type: Number,
            default: 6
        },

        referralCommission: {
            type: [Number], // [10, 5, 3, 2, 1, 1] for 6 levels
            default: [10, 5, 3, 2, 1, 1]
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
        },

        allowWithdrawals: {
            type: Boolean,
            default: true
        },

        allowDeposits: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("AdminSettings", adminSettingsSchema);
