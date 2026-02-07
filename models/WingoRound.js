const mongoose = require('mongoose');

const wingoRoundSchema = new mongoose.Schema({
  roundId: {
    type: String,
    required: true,
    unique: true
  },
  gameType: {
    type: String,
    required: true,
    enum: ['wingo1min', 'wingo3min', 'wingo5min', 'wingo10min']
  },
  result: {
    type: Number,
    min: 0,
    max: 9,
    default: null
  },
  color: {
    type: String,
    enum: ['green', 'red', 'violet', null],
    default: null
  },
  size: {
    type: String,
    enum: ['big', 'small', null],
    default: null
  },
  status: {
    type: String,
    enum: ['betting', 'calculating', 'completed'],
    default: 'betting'
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  totalBets: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('WingoRound', wingoRoundSchema);
