const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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
    
    // Wallet & Bonuses
    wallet: { 
        type: Number, 
        default: 100,
        min: 0,
        get: v => Math.round(v * 100) / 100,
        set: v => Math.round(v * 100) / 100
    },
    bonus: { 
        type: Number, 
        default: 100,
        min: 0,
        get: v => Math.round(v * 100) / 100,
        set: v => Math.round(v * 100) / 100
    },
    
    // Deposit Info
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
    
    // Withdrawal Info
    withdrawMethod: { 
        type: String, 
        enum: ['upi', 'bank', 'usdt', null],
        default: null 
    },
    withdrawDetails: { 
        type: mongoose.Schema.Types.Mixed,
        default: null 
    },
    withdrawalHeld: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Referral System
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
    
    // Account Status
    banned: {
        type: Boolean,
        default: false
    },
    
    // Activity Tracking
    lastLogin: {
        type: Date,
        default: null
    },
    lastBet: {
        type: Date,
        default: null
    }
}, { 
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Password comparison method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

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

// Indexes for better performance
userSchema.index({ mobile: 1 }, { unique: true });
userSchema.index({ referralCode: 1 }, { unique: true });
userSchema.index({ referredBy: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ wallet: -1 });
userSchema.index({ totalWagered: -1 });

module.exports = mongoose.model('User', userSchema);
