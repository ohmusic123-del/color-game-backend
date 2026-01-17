const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
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
    default: 'upi'
  },
  referenceId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['PENDING', 'SUCCESS', 'FAILED'],
    default: 'PENDING'
  },
  adminNote: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Index for performance
depositSchema.index({ mobile: 1 });
depositSchema.index({ status: 1 });
depositSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Deposit', depositSchema);
