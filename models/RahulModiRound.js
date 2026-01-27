const mongoose = require('mongoose');

const rahulModiRoundSchema = new mongoose.Schema({
  roundId: {
    type: String,
    required: true,
    unique: true
  },
  rahulPool: {
    type: Number,
    default: 0
  },
  modiPool: {
    type: Number,
    default: 0
  },
  winner: {
    type: String,
    enum: ['rahul', 'modi', null],
    default: null
  }
}, {
  timestamps: true
});

// Index for performance
rahulModiRoundSchema.index({ roundId: 1 });
rahulModiRoundSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RahulModiRound', rahulModiRoundSchema);
