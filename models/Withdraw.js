const mongoose = require('mongoose');

const withdrawSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 100
  },
  method: {
    type: String,
    enum: ['upi', 'bank', 'usdt'],
    required: true
  },
  details: {
    type: Object,
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  adminNote: {
    type: String,
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for performance
withdrawSchema.index({ mobile: 1 });
withdrawSchema.index({ status: 1 });
withdrawSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Withdraw', withdrawSchema);
