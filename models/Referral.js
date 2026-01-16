const mongoose = require("mongoose");

const referralSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            index: true
        },
        referredUserId: {
            type: String,
            required: true
        },
        level: {
            type: Number,
            required: true,
            min: 1,
            max: 6
        },
        commission: {
            type: Number,
            required: true,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        },
        type: {
            type: String,
            enum: ["DEPOSIT", "BET"],
            required: true
        },
        amount: {
            type: Number,
            required: true,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        }
    },
    { timestamps: true }
);

// Indexes for better performance
referralSchema.index({ userId: 1 });
referralSchema.index({ referredUserId: 1 });
referralSchema.index({ createdAt: -1 });
referralSchema.index({ userId: 1, type: 1 });

module.exports = mongoose.model("Referral", referralSchema);
