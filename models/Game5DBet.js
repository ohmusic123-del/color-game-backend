const mongoose = require('mongoose');

const game5DBetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  roundId: {
    type: String,
    required: true
  },
  gameType: {
    type: String,
    required: true,
    enum: ['5d1min', '5d3min', '5d5min', '5d10min']
  },
  betType: {
    type: String,
    required: true
  },
  selection: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  multiplier: {
    type: Number,
    default: 9
  },
  status: {
    type: String,
    enum: ['pending', 'win', 'loss'],
    default: 'pending'
  },
  winAmount: {
    type: Number,
    default: 0
  },
  result: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Game5DBet', game5DBetSchema);
