const mongoose = require('mongoose');

const trxBetSchema = new mongoose.Schema({
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
    enum: ['trx1min', 'trx3min', 'trx5min', 'trx10min']
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
  status: {
    type: String,
    enum: ['pending', 'win', 'loss'],
    default: 'pending'
  },
  winAmount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('TRXBet', trxBetSchema);
