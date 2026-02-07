const mongoose = require('mongoose');

const wingoBetSchema = new mongoose.Schema({
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
    enum: ['wingo1min', 'wingo3min', 'wingo5min', 'wingo10min']
  },
  betType: {
    type: String,
    required: true,
    enum: ['color', 'number', 'big', 'small']
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
    default: 2
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
  resultNumber: {
    type: Number,
    default: null
  },
  resultColor: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('WingoBet', wingoBetSchema);
