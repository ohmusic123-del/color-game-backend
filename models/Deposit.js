const mongoose = require("mongoose");

const depositSchema = new mongoose.Schema(
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

        // Optional reference details
        referenceId: {
            type: String,
            index: true
        },

        status: {
            type: String,
            enum: ["PENDING", "SUCCESS", "FAILED"],
            default: "PENDING"
        },

        adminNote: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

// Indexes for better performance
depositSchema.index({ mobile: 1, createdAt: -1 });
depositSchema.index({ status: 1 });
depositSchema.index({ createdAt: -1 });
depositSchema.index({ referenceId: 1 });

