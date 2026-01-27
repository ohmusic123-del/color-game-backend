const mongoose = require('mongoose');

const rahulModiBetSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true
  },
  roundId: {
    type: String,
    required: true
  },
  option: {
    type: String,
    required: true,
    enum: ['rahul', 'modi']
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
rahulModiBetSchema.index({ mobile: 1, roundId: 1 });
rahulModiBetSchema.index({ roundId: 1 });
rahulModiBetSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RahulModiBet', rahulModiBetSchema);
