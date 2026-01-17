const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true
  },
  roundId: {
    type: String,
    required: true
  },
  color: {
    type: String,
    required: true,
    enum: ['red', 'green']
  },
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['PENDING', 'WON', 'LOST'],
    default: 'PENDING'
  },
  winAmount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for performance
betSchema.index({ mobile: 1, roundId: 1 });
betSchema.index({ roundId: 1 });
betSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Bet', betSchema);
