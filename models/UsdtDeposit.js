const mongoose = require("mongoose");

const usdtDepositSchema = new mongoose.Schema(
    {
        mobile: {
            type: String,
            required: true,
            index: true
        },

        amount: {
            type: Number,
            required: true,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        },

        network: {
            type: String,
            enum: ["TRC20", "ERC20"],
            default: "TRC20"
        },

        txHash: {
            type: String,
            required: true,
            unique: true
        },

        fromAddress: {
            type: String
        },

        toAddress: {
            type: String,
            required: true
        },

        status: {
            type: String,
            enum: ["PENDING", "CONFIRMED", "FAILED"],
            default: "PENDING"
        },

        confirmations: {
            type: Number,
            default: 0
        },

        adminNote: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

// Indexes for better performance
usdtDepositSchema.index({ mobile: 1 });
usdtDepositSchema.index({ txHash: 1 }, { unique: true });
usdtDepositSchema.index({ status: 1 });
usdtDepositSchema.index({ createdAt: -1 });

module.exports = mongoose.model("UsdtDeposit", usdtDepositSchema);
