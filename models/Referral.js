const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
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
    min: 0
  },
  type: {
    type: String,
    enum: ['DEPOSIT', 'BET'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

// Index for performance
referralSchema.index({ userId: 1 });
referralSchema.index({ referredUserId: 1 });
referralSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Referral', referralSchema);
