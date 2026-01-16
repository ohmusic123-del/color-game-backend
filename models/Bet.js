const mongoose = require("mongoose");

const betSchema = new mongoose.Schema(
    {
        mobile: {
            type: String,
            required: true,
            index: true
        },

        roundId: {
            type: String,
            required: true,
            index: true
        },

        color: {
            type: String,
            enum: ["red", "green"],
            required: true
        },

        amount: {
            type: Number,
            required: true,
            min: 1,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        },

        status: {
            type: String,
            enum: ["PENDING", "WON", "LOST"],
            default: "PENDING"
        },

        winAmount: {
            type: Number,
            default: 0,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        }
    },
    { timestamps: true }
);

// Indexes for better performance
betSchema.index({ mobile: 1, roundId: 1 });
betSchema.index({ roundId: 1, status: 1 });
betSchema.index({ mobile: 1, createdAt: -1 });
betSchema.index({ createdAt: -1 });
betSchema.index({ status: 1 });

module.exports = mongoose.model("Bet", betSchema);
