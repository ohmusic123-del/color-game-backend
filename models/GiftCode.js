const mongoose = require('mongoose');

const giftCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  createdBy: {
    type: String, // mobile number of creator
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 10,
    max: 10000,
    get: v => Math.round(v * 100) / 100,
    set: v => Math.round(v * 100) / 100
  },
  type: {
    type: String,
    enum: ['one-to-one', 'one-to-many'],
    required: true
  },
  maxRedemptions: {
    type: Number,
    default: 1, // 1 for one-to-one, unlimited for one-to-many
    min: 1
  },
  redemptionCount: {
    type: Number,
    default: 0,
    min: 0
  },
  redeemedBy: [{
    mobile: String,
    redeemedAt: {
      type: Date,
      default: Date.now
    },
    amount: Number
  }],
  expiresAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'fully-redeemed'],
    default: 'active'
  },
  description: {
    type: String,
    maxlength: 200
  }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// Index for performance
giftCodeSchema.index({ code: 1 });
giftCodeSchema.index({ createdBy: 1 });
giftCodeSchema.index({ status: 1 });
giftCodeSchema.index({ expiresAt: 1 });

// Method to check if code can be redeemed
giftCodeSchema.methods.canRedeem = function(mobile) {
  // Check if expired
  if (new Date() > this.expiresAt) {
    this.status = 'expired';
    return { success: false, message: 'Gift code has expired' };
  }

  // Check if already redeemed by this user
  const alreadyRedeemed = this.redeemedBy.some(r => r.mobile === mobile);
  if (alreadyRedeemed) {
    return { success: false, message: 'You have already redeemed this gift code' };
  }

  // Check if code creator is trying to redeem
  if (this.createdBy === mobile) {
    return { success: false, message: 'You cannot redeem your own gift code' };
  }

  // Check if fully redeemed (for one-to-one or limited redemptions)
  if (this.type === 'one-to-one' && this.redemptionCount >= 1) {
    this.status = 'fully-redeemed';
    return { success: false, message: 'Gift code has already been redeemed' };
  }

  if (this.redemptionCount >= this.maxRedemptions) {
    this.status = 'fully-redeemed';
    return { success: false, message: 'Gift code redemption limit reached' };
  }

  return { success: true };
};

// Method to redeem code
giftCodeSchema.methods.redeem = function(mobile) {
  this.redeemedBy.push({
    mobile,
    redeemedAt: new Date(),
    amount: this.amount
  });
  this.redemptionCount += 1;

  // Update status if fully redeemed
  if (this.type === 'one-to-one' || this.redemptionCount >= this.maxRedemptions) {
    this.status = 'fully-redeemed';
  }
};

module.exports = mongoose.model('GiftCode', giftCodeSchema);
