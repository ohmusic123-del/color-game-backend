const mongoose = require("mongoose");

const roundSchema = new mongoose.Schema(
    {
        roundId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        redPool: {
            type: Number,
            required: true,
            default: 0,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        },

        greenPool: {
            type: Number,
            required: true,
            default: 0,
            get: v => Math.round(v * 100) / 100,
            set: v => Math.round(v * 100) / 100
        },

        winner: {
            type: String,
            enum: ["red", "green", null],
            default: null
        },

        processed: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

// Indexes for better performance
roundSchema.index({ roundId: 1 }, { unique: true });
roundSchema.index({ createdAt: -1 });
roundSchema.index({ winner: 1 });
roundSchema.index({ processed: 1 });

module.exports = mongoose.model("Round", roundSchema);
