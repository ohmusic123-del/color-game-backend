// models/User.js - FIXED VERSION
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  mobile: { 
    type: String, 
    required: true, 
    unique: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{10}$/.test(v);
      },
      message: 'Mobile number must be exactly 10 digits'
    }
  },
  password: { 
    type: String, 
    required: true 
  },
  
  // Use Number with precision control instead of Decimal128 for simplicity
  wallet: { 
    type: Number, 
    default: 100,
    min: 0,
    get: v => Math.round(v * 100) / 100, // 2 decimal places
    set: v => Math.round(v * 100) / 100
  },
  bonus: { 
    type: Number, 
    default: 100,
    min: 0,
    get: v => Math.round(v * 100) / 100,
    set: v => Math.round(v * 100) / 100
  },
  
  deposited: { 
    type: Boolean, 
    default: false 
  },
  depositAmount: { 
    type: Number, 
    default: 0,
    min: 0,
    get: v => Math.round(v * 100) / 100,
    set: v => Math.round(v * 100) / 100
  },
  totalWagered: { 
    type: Number, 
    default: 0,
    min: 0,
    get: v => Math.round(v * 100) / 100,
    set: v => Math.round(v * 100) / 100
  },
  
  withdrawMethod: { 
    type: String, 
    enum: ['upi', 'bank', 'usdt', null],
    default: null 
  },
  withdrawDetails: { 
    type: Object, 
    default: null 
  },
  
  referralCode: { 
    type: String, 
    unique: true, 
    required: true 
  },
  referredBy: { 
    type: String, 
    default: null 
  },
  referralEarnings: { 
    type: Number, 
    default: 0,
    min: 0,
    get: v => Math.round(v * 100) / 100,
    set: v => Math.round(v * 100) / 100
  },
  totalReferrals: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  banned: {
    type: Boolean,
    default: false
  }
}, { 
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// Method to safely update wallet
userSchema.methods.updateWallet = function(amount) {
  this.wallet = Math.round((this.wallet + amount) * 100) / 100;
  if (this.wallet < 0) this.wallet = 0;
};

// Method to safely update bonus
userSchema.methods.updateBonus = function(amount) {
  this.bonus = Math.round((this.bonus + amount) * 100) / 100;
  if (this.bonus < 0) this.bonus = 0;
};

module.exports = mongoose.model('User', userSchema);
