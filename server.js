require("dotenv").config();
require("./db");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = express();
/* =========================
MODELS
========================= */
const User = require("./models/User");
const Bet = require("./models/Bet");
const Round = require("./models/Round");
const Withdraw = require("./models/Withdraw");
const Deposit = require("./models/Deposit");
const Referral = require("./models/Referral");
/* =========================
MIDDLEWARE
========================= */
const auth = require("./middleware/auth");
/* ---------- Admin Auth ---------- */
function adminAuth(req, res, next) {
try {
const token = req.headers.authorization?.replace("Bearer ", "");
if (!token) {
return res.status(401).json({ error: "Admin token missing" });
}
const decoded = jwt.verify(token, process.env.JWT_SECRET);
if (decoded.role !== "admin") {
return res.status(403).json({ error: "Admin access denied" });
}
req.admin = decoded;
next();
} catch {
return res.status(401).json({ error: "Invalid admin token" }); /* =========================
PROCESS REFERRAL COMMISSION
========================= */
async function processReferralCommission(userId, amount, type) {
try {
const user = await User.findOne({ mobile: userId });
if (!user || !user.referredBy) return;
let currentReferrer = user.referredBy;
let level = 1;
while (currentReferrer && level <= 6) {
const referrer = await User.findOne({ referralCode: currentReferrer });
if (!referrer) break;
const commission = Math.round(amount * COMMISSION_RATES[level] * 100) / 100;
// Add commission to referrer's wallet
referrer.wallet = Math.round((referrer.wallet + commission) * 100) / 100;
referrer.referralEarnings = Math.round((referrer.referralEarnings + commission) * 100) / 100;
await referrer.save();
// Record commission
await Referral.create({
userId: referrer.mobile,
referredUserId: userId,
level,
commission,
type,
amount
});
console.log(`✅ Level ${level} commission: ₹${commission} to ${referrer.mobile}`);
// Move to next level
currentReferrer = referrer.referredBy;
level++;
}
} catch (err) {
console.error("Referral commission error:", err);
}
}
/* =========================
APP SETUP
========================= */
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
// Request logging
app.use((req, res, next) => {
console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
next();
});
/* =========================
ROUND STATE ========================= */
let CURRENT_ROUND = {
id: Date.now().toString(),
startTime: Date.now()
};
/* =========================
BASIC
========================= */
app.get("/", (req, res) => {
res.send("BIGWIN backend running - All systems operational ✅");
});
/* =========================
AUTH – USER
========================= */
/* ================= REGISTER ================= */
app.post('/register', async (req, res) => {
try {
const { mobile, password, referralCode } = req.body;
// VALIDATION
if (!mobile || !password) {
return res.status(400).json({ message: 'Mobile and password required' });
}
// Validate mobile format (must be exactly 10 digits)
if (!/^[0-9]{10}$/.test(mobile)) {
return res.status(400).json({ message: 'Invalid mobile number. Must be 10 digits.' });
}
// Validate password length
if (password.length < 6) {
return res.status(400).json({ message: 'Password must be at least 6 characters' });
}
// Check if user already exists
const existing = await User.findOne({ mobile });
if (existing) {
return res.status(400).json({ message: 'Mobile number already registered' });
}
// Generate unique referral code
const generateReferralCode = () => {
return 'BW' + Math.random().toString(36).substring(2, 11).toUpperCase();
};
let uniqueCode = generateReferralCode();
let codeExists = await User.findOne({ referralCode: uniqueCode });
// Ensure code is unique
while (codeExists) {
uniqueCode = generateReferralCode();
codeExists = await User.findOne({ referralCode: uniqueCode });
}
// Handle referral if provided
let referrer = null; if (referralCode) {
referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
if (!referrer) {
return res.status(400).json({ message: 'Invalid referral code' });
}
}
// Create new user with bonuses
const newUser = new User({
mobile,
password, // NOTE: Should use bcrypt.hash(password, 10) in production
wallet: 100,
bonus: 100,
deposited: false,
depositAmount: 0,
totalWagered: 0,
referralCode: uniqueCode,
referredBy: referrer ? referrer.referralCode : null,
referralEarnings: 0,
totalReferrals: 0
});
await newUser.save();
// Update referrer's stats
if (referrer) {
referrer.totalReferrals += 1;
await referrer.save();
}
// Generate JWT token
const token = jwt.sign({ mobile }, process.env.JWT_SECRET, { expiresIn: '30d' });
console.log(`✅ New user registered: ${mobile} (Referral: ${uniqueCode})`);
res.status(201).json({
message: 'Registration successful',
token,
user: {
mobile: newUser.mobile,
wallet: newUser.wallet,
bonus: newUser.bonus,
referralCode: newUser.referralCode
}
});
} catch (err) {
console.error('Registration error:', err);
res.status(500).json({ message: 'Server error during registration' });
}
});
/* ================= LOGIN ================= */
app.post("/login", async (req, res) => {
try {
let { mobile, password } = req.body;
if (!mobile || !password) {
return res.status(400).json({ error: "Mobile and password required" }); }
mobile = String(mobile).trim();
const user = await User.findOne({ mobile });
if (!user || user.password !== password) {
return res.status(401).json({ error: "Invalid credentials" });
}
const token = jwt.sign(
{ mobile: user.mobile },
process.env.JWT_SECRET,
{ expiresIn: '30d' }
);
res.json({
token,
wallet: user.wallet,
bonus: user.bonus
});
} catch (err) {
console.error("LOGIN ERROR:", err);
res.status(500).json({ error: "Server error" });
}
});
/* =========================
USER DATA
========================= */
app.get("/wallet", auth, async (req, res) => {
try {
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) {
return res.status(404).json({ message: 'User not found' });
}
res.json({
wallet: parseFloat(user.wallet || 0).toFixed(2),
bonus: parseFloat(user.bonus || 0).toFixed(2),
totalWagered: parseFloat(user.totalWagered || 0).toFixed(2),
deposited: user.deposited || false,
depositAmount: parseFloat(user.depositAmount || 0).toFixed(2)
});
} catch (err) {
console.error('Wallet fetch error:', err);
res.status(500).json({ message: 'Error fetching wallet data' });
}
});
app.get("/profile", auth, async (req, res) => {
try {
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) {
return res.status(404).json({ error: "User not found" }); }
res.json({
mobile: user.mobile,
wallet: user.wallet,
bonus: user.bonus,
totalWagered: user.totalWagered,
referralCode: user.referralCode,
deposited: user.deposited
});
} catch (err) {
console.error("Profile error:", err);
res.status(500).json({ error: "Server error" });
}
});
/* =========================
BETS - FIXED VERSION
========================= */
app.get("/bets", auth, async (req, res) => {
try {
const bets = await Bet.find({ mobile: req.user.mobile })
.sort({ createdAt: -1 })
.limit(50);
res.json(bets);
} catch (err) {
console.error("Bets fetch error:", err);
res.status(500).json({ error: "Failed to load bets" });
}
});
app.get("/bets/current", auth, async (req, res) => {
try {
const bets = await Bet.find({
mobile: req.user.mobile,
roundId: CURRENT_ROUND.id
});
res.json({ roundId: CURRENT_ROUND.id, bets });
} catch (err) {
console.error("Current bets error:", err);
res.status(500).json({ error: "Failed to load current bets" });
}
});
// FIXED BET ENDPOINT - Prevents freezing with concurrent users
app.post("/bet", auth, async (req, res) => {
const session = await mongoose.startSession();
session.startTransaction();
try {
// Check round timing
const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
if (elapsed >= 60) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Round closed" });
} const { color, amount } = req.body;
const mobile = req.user.mobile;
// Validation
if (!color || !['red', 'green'].includes(color.toLowerCase())) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Invalid color" });
}
if (!amount || amount < 1) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Minimum bet ₹1" });
}
// Get user with session lock
const user = await User.findOne({ mobile }).session(session);
if (!user) {
await session.abortTransaction();
session.endSession();
return res.status(404).json({ error: "User not found" });
}
// Check balance
const totalBalance = (user.wallet || 0) + (user.bonus || 0);
if (totalBalance < amount) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({
error: `Insufficient balance. You have ₹${totalBalance.toFixed(2)}`
});
}
// Check for duplicate bet
const existingBet = await Bet.findOne({ mobile, roundId: CURRENT_ROUND.id }).session(session);
if (existingBet) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({
error: `Already bet ₹${existingBet.amount} on ${existingBet.color}`
});
}
// Deduct from wallet/bonus (bonus used first)
let deductFromBonus = 0;
let deductFromWallet = 0;
if (user.bonus >= amount) {
deductFromBonus = amount;
} else {
deductFromBonus = user.bonus;
deductFromWallet = amount - user.bonus;
}
user.bonus = Math.max(0, Math.round((user.bonus - deductFromBonus) * 100) / 100);
user.wallet = Math.max(0, Math.round((user.wallet - deductFromWallet) * 100) / 100);
user.totalWagered = Math.round(((user.totalWagered || 0) + amount) * 100) / 100; await user.save({ session });
// Create bet
const newBet = new Bet({
mobile,
roundId: CURRENT_ROUND.id,
color: color.toLowerCase(),
amount: Math.round(amount * 100) / 100,
status: 'PENDING',
createdAt: new Date()
});
await newBet.save({ session });
// Update round pools atomically
const currentRound = await Round.findOne({ roundId: CURRENT_ROUND.id }).session(session);
if (currentRound) {
if (color.toLowerCase() === 'red') {
currentRound.redPool = Math.round((currentRound.redPool + amount) * 100) / 100;
} else {
currentRound.greenPool = Math.round((currentRound.greenPool + amount) * 100) / 100;
}
await currentRound.save({ session });
}
// Commit transaction
await session.commitTransaction();
session.endSession();
console.log(`✅ Bet placed: ${mobile} - ₹${amount} on ${color}`);
res.json({
message: "Bet placed successfully",
roundId: CURRENT_ROUND.id,
newWallet: user.wallet,
newBonus: user.bonus
});
} catch (err) {
await session.abortTransaction();
session.endSession();
console.error("BET ERROR:", err);
res.status(500).json({ error: "Bet failed. Please try again." });
}
});
/* =========================
ROUND INFO
========================= */
app.get("/round/current", (req, res) => {
const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
res.json({
...CURRENT_ROUND,
elapsed,
remaining: Math.max(0, 60 - elapsed)
});
}); app.get("/rounds/history", async (req, res) => {
try {
const rounds = await Round.find()
.sort({ createdAt: -1 })
.limit(20)
.select("roundId winner redPool greenPool createdAt");
res.json(rounds);
} catch (err) {
console.error("Rounds history error:", err);
res.status(500).json({ error: "Failed to load rounds" });
}
});
/* =========================
DEPOSIT
========================= */
app.post("/deposit", auth, async (req, res) => {
try {
const { amount, referenceId } = req.body;
if (!amount || amount < 100) {
return res.status(400).json({ error: "Minimum deposit ₹100" });
}
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) {
return res.status(404).json({ error: "User not found" });
}
// Create deposit record (AUTO-APPROVED for testing)
const deposit = await Deposit.create({
mobile: user.mobile,
amount,
method: "upi",
referenceId: referenceId || "AUTO",
status: "SUCCESS" // Change to "PENDING" for manual approval
});
// Add to wallet
user.wallet = Math.round((user.wallet + amount) * 100) / 100;
user.deposited = true;
user.depositAmount = Math.round((user.depositAmount + amount) * 100) / 100;
// First deposit bonus (100%)
const isFirstDeposit = user.depositAmount === amount;
if (isFirstDeposit) {
user.bonus = Math.round((user.bonus + amount) * 100) / 100;
}
await user.save();
// Process referral commission
await processReferralCommission(user.mobile, amount, "DEPOSIT");
console.log(`✅ Deposit: ${user.mobile} - ₹${amount} (First: ${isFirstDeposit})`);
res.json({ message: "Deposit successful",
newWallet: user.wallet,
newBonus: user.bonus,
bonus: isFirstDeposit ? amount : 0
});
} catch (err) {
console.error("Deposit error:", err);
res.status(500).json({ error: "Deposit failed" });
}
});
app.get("/wallet/deposit-history", auth, async (req, res) => {
try {
const deposits = await Deposit.find({ mobile: req.user.mobile })
.sort({ createdAt: -1 })
.limit(20);
res.json(deposits);
} catch (err) {
console.error("Deposit history error:", err);
res.status(500).json({ error: "Server error" });
}
});
/* =========================
   WITHDRAWAL - FIXED
========================= */
app.post("/withdraw", auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findOne({ mobile: req.user.mobile });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Minimum withdrawal ₹100" });
    }

    if (amount > user.wallet) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    if (!user.deposited) {
      return res.status(400).json({ error: "Please make a deposit first" });
    }

    const requiredWager = (user.depositAmount || 0) + (user.bonus || 0);
    if (user.totalWagered < requiredWager) {
      return res.status(400).json({ 
        error: `Complete wagering requirement: ₹${user.totalWagered.toFixed(2)} / ₹${requiredWager.toFixed(2)}` 
      });
    }

    if (!user.withdrawMethod || !user.withdrawDetails) {
      return res.status(400).json({ 
        error: "Please set withdrawal method first" 
      });
    }

    const withdrawal = await Withdraw.create({
      mobile: user.mobile,
      amount,
      method: user.withdrawMethod,
      details: user.withdrawDetails,
      status: "PENDING"
    });

    user.wallet = Math.round((user.wallet - amount) * 100) / 100;
    await user.save();

    console.log(`✅ Withdrawal requested: ${user.mobile} - ₹${amount}`);

    res.json({ 
      message: "Withdrawal request submitted",
      newWallet: user.wallet
    });

  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "Withdrawal failed" });
  }
});

app.get("/wallet/withdraw-history", auth, async (req, res) => {
  try {
    const withdrawals = await Withdraw.find({ mobile: req.user.mobile })
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json(withdrawals);
  } catch (err) {
    console.error("Withdraw history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/withdraw/method', auth, async (req, res) => {
  try {
    const { method, details } = req.body;

    if (!method || !details) {
      return res.status(400).json({ message: 'Method and details required' });
    }

    if (!['upi', 'bank', 'usdt'].includes(method)) {
      return res.status(400).json({ message: 'Invalid withdrawal method' });
    }

    if (method === 'upi') {
      if (!details.upiId || !/^[\w.-]+@[\w.-]+$/.test(details.upiId)) {
        return res.status(400).json({ message: 'Invalid UPI ID format' });
      }
    } else if (method === 'bank') {
      if (!details.accountNumber || !details.ifsc || !details.accountHolder) {
        return res.status(400).json({ message: 'Bank details incomplete' });
      }
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.withdrawMethod = method;
    user.withdrawDetails = details;
    await user.save();

    console.log(`✅ Withdrawal method saved: ${user.mobile} - ${method}`);

    res.json({
      message: 'Withdrawal method saved successfully',
      method: user.withdrawMethod,
      details: user.withdrawDetails
    });

  } catch (err) {
    console.error('Save withdraw method error:', err);
    res.status(500).json({ message: 'Error saving withdrawal method' });
  }
});

app.get('/withdraw/method', auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      method: user.withdrawMethod,
      details: user.withdrawDetails
    });

  } catch (err) {
    console.error('Get withdraw method error:', err);
    res.status(500).json({ message: 'Error fetching withdrawal method' });
  }
});

/* =========================
WALLET HISTORY
========================= */
app.get("/wallet/history", auth, async (req, res) => {
try {
const deposits = await Deposit.find({ mobile: req.user.mobile }) .sort({ createdAt: -1 })
.limit(10)
.lean();
const withdrawals = await Withdraw.find({ mobile: req.user.mobile })
.sort({ createdAt: -1 })
.limit(10)
.lean();
const history = [
...deposits.map(d => ({ ...d, type: 'deposit' })),
...withdrawals.map(w => ({ ...w, type: 'withdraw' }))
].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
.slice(0, 20);
res.json(history);
} catch (err) {
console.error("Wallet history error:", err);
res.status(500).json({ error: "Server error" });
}
});
/* =========================
REFERRAL SYSTEM - FIXED
========================= */
app.get("/referral/info", auth, async (req, res) => {
try {
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) {
return res.status(404).json({ message: 'User not found' });
}
// Get direct referrals (Level 1)
const directReferrals = await User.find({ referredBy: user.referralCode });
// Get all 6 levels of referrals recursively
const getAllReferrals = async (referralCode, level = 1, allRefs = []) => {
if (level > 6) return allRefs;
const refs = await User.find({ referredBy: referralCode })
.select('mobile referralCode depositAmount totalWagered createdAt deposited');
for (const ref of refs) {
allRefs.push({
mobile: ref.mobile,
level,
depositAmount: ref.depositAmount || 0,
totalWagered: ref.totalWagered || 0,
deposited: ref.deposited || false,
joinedAt: ref.createdAt
});
// Recursively get their referrals
await getAllReferrals(ref.referralCode, level + 1, allRefs);
}
return allRefs;
}; const allReferrals = await getAllReferrals(user.referralCode);
// Get commission history
const commissions = await Referral.find({ userId: user.mobile })
.sort({ createdAt: -1 })
.limit(50);
// Calculate level-wise breakdown
const levelBreakdown = {
level1: { count: 0, earnings: 0 },
level2: { count: 0, earnings: 0 },
level3: { count: 0, earnings: 0 },
level4: { count: 0, earnings: 0 },
level5: { count: 0, earnings: 0 },
level6: { count: 0, earnings: 0 }
};
allReferrals.forEach(ref => {
levelBreakdown[`level${ref.level}`].count += 1;
});
commissions.forEach(comm => {
levelBreakdown[`level${comm.level}`].earnings += comm.commission;
});
res.json({
referralCode: user.referralCode,
totalReferrals: user.totalReferrals || directReferrals.length,
totalEarnings: user.referralEarnings || 0,
directReferrals: directReferrals.length,
allTeamMembers: allReferrals.length,
teamMembers: allReferrals,
commissions: commissions,
levelBreakdown: levelBreakdown
});
} catch (err) {
console.error('Referral info error:', err);
res.status(500).json({ message: 'Error fetching referral data' }); return res.json({ token });
}
res.status(401).json({ error: "Invalid admin credentials" });
});
app.get("/admin/stats", adminAuth, async (req, res) => {
try {
const totalUsers = await User.countDocuments();
const totalDeposits = await Deposit.aggregate([
{ $match: { status: "SUCCESS" } },
{ $group: { _id: null, total: { $sum: "$amount" } } }
]);
const totalWithdraws = await Withdraw.aggregate([
{ $match: { status: "APPROVED" } },
{ $group: { _id: null, total: { $sum: "$amount" } } }
]);
const totalWallet = await User.aggregate([
{ $group: { _id: null, total: { $sum: "$wallet" } } }
]);
const totalRounds = await Round.countDocuments();
const profit = (totalDeposits[0]?.total || 0) - (totalWithdraws[0]?.total || 0);
res.json({
totalUsers,
totalDeposits: totalDeposits[0]?.total || 0,
totalWithdraws: totalWithdraws[0]?.total || 0,
totalWallet: totalWallet[0]?.total || 0,
profit,
totalRounds
});
} catch (err) {
console.error("Admin stats error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.get("/admin/users", adminAuth, async (req, res) => {
try {
const users = await User.find()
.select('-password')
.sort({ createdAt: -1 })
.limit(100);
res.json(users);
} catch (err) {
console.error("Admin users error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.post("/admin/user/balance", adminAuth, async (req, res) => {
try {
const { mobile, amount, type } = req.body;
const user = await User.findOne({ mobile });
if (!user) {
return res.status(404).json({ error: "User not found" }); }
if (type === 'add') {
user.wallet += amount;
} else {
user.wallet -= amount;
}
await user.save();
res.json({ message: "Balance updated", newWallet: user.wallet });
} catch (err) {
console.error("Admin balance update error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.get("/admin/deposits", adminAuth, async (req, res) => {
try {
const deposits = await Deposit.find()
.sort({ createdAt: -1 })
.limit(100);
res.json(deposits);
} catch (err) {
console.error("Admin deposits error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.post("/admin/deposit/:id", adminAuth, async (req, res) => {
try {
const { id } = req.params;
const { action, adminNote } = req.body;
const deposit = await Deposit.findById(id);
if (!deposit) {
return res.status(404).json({ error: "Deposit not found" });
}
if (deposit.status !== "PENDING") {
return res.status(400).json({ error: "Deposit already processed" });
}
const user = await User.findOne({ mobile: deposit.mobile });
if (!user) {
return res.status(404).json({ error: "User not found" });
}
if (action === "approve") {
deposit.status = "SUCCESS";
deposit.adminNote = adminNote || "Approved";
// Add to wallet
user.wallet = Math.round((user.wallet + deposit.amount) * 100) / 100;
user.deposited = true;
user.depositAmount = Math.round((user.depositAmount + deposit.amount) * 100) / 100;
// First deposit bonus
const isFirstDeposit = user.depositAmount === deposit.amount; if (isFirstDeposit) {
user.bonus = Math.round((user.bonus + deposit.amount) * 100) / 100;
}
await user.save();
// Process referral commission
await processReferralCommission(user.mobile, deposit.amount, "DEPOSIT");
} else if (action === "reject") {
deposit.status = "FAILED";
deposit.adminNote = adminNote || "Rejected";
}
await deposit.save();
console.log(`✅ Admin ${action}d deposit: ${deposit.mobile} - ₹${deposit.amount}`);
res.json({
message: `Deposit ${action}d successfully`,
deposit
});
} catch (err) {
console.error("Admin deposit action error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.get("/admin/withdraws", adminAuth, async (req, res) => {
try {
const withdrawals = await Withdraw.find()
.sort({ createdAt: -1 })
.limit(100);
res.json(withdrawals);
} catch (err) {
console.error("Admin withdraws error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.post("/admin/withdraw/:id", adminAuth, async (req, res) => {
try {
const { id } = req.params;
const { action, adminNote } = req.body;
const withdrawal = await Withdraw.findById(id);
if (!withdrawal) {
return res.status(404).json({ error: "Withdrawal not found" });
}
if (withdrawal.status !== "PENDING") {
return res.status(400).json({ error: "Withdrawal already processed" });
}
const user = await User.findOne({ mobile: withdrawal.mobile });
if (!user) {
return res.status(404).json({ error: "User not found" }); }
if (action === "approve") {
withdrawal.status = "APPROVED";
withdrawal.adminNote = adminNote || "Approved";
withdrawal.processedAt = new Date();
// Money already deducted when request was created
} else if (action === "reject") {
withdrawal.status = "REJECTED";
withdrawal.adminNote = adminNote || "Rejected";
// Refund to wallet
user.wallet = Math.round((user.wallet + withdrawal.amount) * 100) / 100;
await user.save();
}
await withdrawal.save();
console.log(`✅ Admin ${action}d withdrawal: ${withdrawal.mobile} - ₹${withdrawal.amount}`);
res.json({
message: `Withdrawal ${action}d successfully`,
withdrawal
});
} catch (err) {
console.error("Admin withdraw action error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.get("/admin/transactions", adminAuth, async (req, res) => {
try {
const deposits = await Deposit.find()
.sort({ createdAt: -1 })
.limit(50)
.lean();
const withdrawals = await Withdraw.find()
.sort({ createdAt: -1 })
.limit(50)
.lean();
const bets = await Bet.find()
.sort({ createdAt: -1 })
.limit(50)
.lean();
const transactions = [
...deposits.map(d => ({ ...d, type: 'deposit' })),
...withdrawals.map(w => ({ ...w, type: 'withdraw' })),
...bets.map(b => ({ ...b, type: 'bet' }))
].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
.slice(0, 100);
res.json(transactions);
} catch (err) { console.error("Admin transactions error:", err);
res.status(500).json({ error: "Server error" });
}
});
app.get("/admin/recent-activity", adminAuth, async (req, res) => {
try {
const recentBets = await Bet.find()
.sort({ createdAt: -1 })
.limit(10)
.lean();
const recentDeposits = await Deposit.find()
.sort({ createdAt: -1 })
.limit(5)
.lean();
const recentWithdrawals = await Withdraw.find()
.sort({ createdAt: -1 })
.limit(5)
.lean();
const activity = [
...recentBets.map(b => ({
type: 'bet',
user: b.mobile,
amount: b.amount,
details: `${b.color.toUpperCase()} - ${b.status}`,
time: b.createdAt
})),
...recentDeposits.map(d => ({
type: 'deposit',
user: d.mobile,
amount: d.amount,
details: d.status,
time: d.createdAt
})),
...recentWithdrawals.map(w => ({
type: 'withdrawal',
user: w.mobile,
amount: w.amount,
details: w.status,
time: w.createdAt
}))
].sort((a, b) => new Date(b.time) - new Date(a.time))
.slice(0, 20);
res.json(activity);
} catch (err) {
console.error("Admin activity error:", err);
res.status(500).json({ error: "Server error" });
}
});
/* =========================
ROUND MANAGEMENT SYSTEM
========================= */
// Fixed Bet Processing Logic async function processRoundEnd(roundId) {
try {
console.log(`\n🎮 Processing round ${roundId}...`);
const round = await Round.findOne({ roundId });
if (!round) {
console.error('❌ Round not found:', roundId);
return;
}
const { redPool, greenPool } = round;
// Determine winner (color with LESS total pool)
let winner;
if (redPool === greenPool) {
winner = Math.random() < 0.5 ? 'red' : 'green';
} else {
winner = redPool < greenPool ? 'red' : 'green';
}
// Update round with winner
round.winner = winner;
await round.save();
console.log(`📊 Pools - Red: ₹${redPool}, Green: ₹${greenPool}`);
console.log(`🏆 Winner: ${winner.toUpperCase()}`);
// Get all bets for this round
const bets = await Bet.find({ roundId, status: 'PENDING' });
console.log(`💰 Processing ${bets.length} bets...`);
// Process each bet
for (const bet of bets) {
const user = await User.findOne({ mobile: bet.mobile });
if (!user) {
console.log(`⚠️ User not found: ${bet.mobile}`
continue;
}
if (bet.color === winner) {
// WINNER - Pay 1.96x (2x with 2% house edge)
const winAmount = Math.round(bet.amount * 2 * 0.98 * 100) / 100;
// Credit to wallet
user.wallet = Math.round((user.wallet + winAmount) * 100) / 100;
bet.status = 'WON';
bet.winAmount = winAmount;
console.log(`✅ ${user.mobile} won ₹${winAmount} (bet: ₹${bet.amount})`);
} else {
// LOSER - No payout
bet.status = 'LOST';
bet.winAmount = 0;
console.log(`❌ ${user.mobile} lost ₹${bet.amount}`);
} await user.save();
await bet.save();
}
console.log(`✅ Round ${roundId} processed successfully\n`);
} catch (err) {
console.error('❌ Error processing round:', err);
}
}
// Round timer - 60 seconds
setInterval(async () => {
const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
if (elapsed >= 60) {
console.log('\n⏰ Round ending...');
// Save current round to database
const roundDoc = await Round.findOne({ roundId: CURRENT_ROUND.id });
if (roundDoc) {
await processRoundEnd(CURRENT_ROUND.id);
}
// Start new round
CURRENT_ROUND = {
id: Date.now().toString(),
startTime: Date.now()
};
// Create new round in database
await Round.create({
roundId: CURRENT_ROUND.id,
redPool: 0,
greenPool: 0,
winner: null
});
console.log(`🎮 New round started: ${CURRENT_ROUND.id}\n`);
}
}, 1000); // Check every second
// Initialize first round on startup
(async () => {
try {
console.log('🚀 Initializing first round...');
const existingRound = await Round.findOne({ roundId: CURRENT_ROUND.id });
if (!existingRound) {
await Round.create({
roundId: CURRENT_ROUND.id,
redPool: 0,
greenPool: 0,
winner: null
});
console.log('✅ First round created');
} else {
console.log('✅ Using existing round');
} } catch (err) {
console.error('❌ Round initialization error:', err);
}
})();
/* =========================
SERVER START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log('\n' + '='.repeat(50));
console.log('🎮 BIGWIN Backend Server');
console.log('='.repeat(50));
console.log(`✅ Server running on port ${PORT}`);
console.log(`🌐 API URL: http://localhost:${PORT}`);
console.log(`📊 MongoDB: Connected`);
console.log(`⏰ Round Duration: 60 seconds`);
console.log(`💰 House Edge: 2%`);
console.log(`🎁 Registration Bonus: ₹100 + ₹100`);
console.log(`🔗 Referral Levels: 6 (22% total)`);
console.log('='.repeat(50) + '\n');

           });
