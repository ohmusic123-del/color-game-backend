const mongoose = require('mongoose');

const roundSchema = new mongoose.Schema({
  roundId: {
    type: String,
    required: true,
    unique: true
  },
  redPool: {
    type: Number,
    default: 0
  },
  greenPool: {
    type: Number,
    default: 0
  },
  winner: {
    type: String,
    enum: ['red', 'green', null],
    default: null
  }
  
}, 
                                        
{
  timestamps: true
});

// Index for performance
roundSchema.index({ roundId: 1 });
roundSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Round', roundSchema);
