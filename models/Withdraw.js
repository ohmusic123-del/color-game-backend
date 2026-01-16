const mongoose = require("mongoose");

const withdrawSchema = new mongoose.Schema(
    {
        mobile: {
            type: String,
            required: true,
            index: true
        },

        amount: {
            type: Number,
            required: true,
            min: 1,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        },

        method: {
            type: String,
            enum: ["upi", "bank", "usdt"],
            required: true
        },

        // Snapshot of user withdraw details at request time
        details: {
            upiId: String,

            bankName: String,
            accountHolder: String,
            accountNumber: String,
            ifsc: String,

            usdtAddress: String,
            network: String
        },

        status: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED"],
            default: "PENDING",
            index: true
        },

        adminNote: {
            type: String,
            default: ""
        },

        processedAt: {
            type: Date
        }
    },
    { timestamps: true }
);

// Indexes for better performance
withdrawSchema.index({ mobile: 1, createdAt: -1 });
withdrawSchema.index({ status: 1 });
withdrawSchema.index({ createdAt: -1 });
withdrawSchema.index({ mobile: 1, status: 1 });

module.exports = mongoose.model("Withdraw", withdrawSchema);
