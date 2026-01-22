require("dotenv").config();
require("./db");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = express();
const { Cashfree } = require("cashfree-pg");
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.Environment = "PRODUCTION";
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
} catch (err) {
return res.status(401).json({ error: "Invalid admin token" });
}
}
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;

const COMMISSION_RATES = {
  1: 0.10, // 10%
  2: 0.05, // 5%
  3: 0.03, // 3%
  4: 0.02, // 2%
  5: 0.01, // 1%
  6: 0.01  // 1%
};
/* =========================
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
referrer.wallet = Math.round((referrer.wallet + commission) * 100) / 100;
referrer.referralEarnings = Math.round((referrer.referralEarnings + commission) * 100) / 100;
await referrer.save();
await Referral.create({
userId: referrer.mobile,
referredUserId: userId,
level,
commission,
type,
amount
});
console.log(`💰 Level ${level} commission: ₹${commission} to ${referrer.mobile}`);
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
app.use((req, res, next) => {
console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
next();
});
/* =========================
CASHFREE WEBHOOK
========================= */ 
app.post("/api/cashfree/webhook", express.json(), async (req, res) => {
  try {
    // ✅ ALWAYS respond 200 first
    res.status(200).json({ success: true });

    const data = req.body;

    console.log("📩 Cashfree Webhook:", JSON.stringify(data));

    // Only process SUCCESS payments
    if (data?.type !== "PAYMENT_SUCCESS") return;

    const orderId = data.data.order.order_id;
    const amount = Number(data.data.payment.payment_amount);
    const mobile = data.data.customer_details.customer_id;

    if (!orderId || !amount || !mobile) {
      console.log("⚠️ Webhook missing fields");
      return;
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      console.log("⚠️ User not found:", mobile);
      return;
    }

    // Prevent double credit
    const alreadyCredited = await Deposit.findOne({ orderId });
    if (alreadyCredited) {
      console.log("⚠️ Already credited:", orderId);
      return;
    }

    // Save deposit
    await Deposit.create({
      mobile,
      amount,
      orderId,
      status: "SUCCESS"
    });

    // Wallet credit
    user.wallet = Math.round((user.wallet + amount) * 100) / 100;
    user.deposited = true;
    user.depositAmount += amount;

    // First deposit bonus
    if (user.depositAmount === amount) {
      user.bonus += amount;
    }

    await user.save();

    console.log(`✅ Deposit credited: ${mobile} ₹${amount}`);
  } catch (err) {
    console.error("❌ Webhook error:", err);
  }
});
 app.post("/api/cashfree/create-order", auth, async (req, res) => {
try {
const { amount } = req.body;
if (!amount || amount < 100) {
  return res.status(400).json({ error: "Minimum deposit is 100" });
}
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) return res.status(404).json({ message: "User not found" });
const orderId = `ORDER_${Date.now()}`;
const request = {
  order_id: orderId,
  order_amount: amount,
  order_currency: "INR",

  customer_details: {
    customer_id: user.mobile,
    customer_phone: user.mobile,
    customer_email: `${user.mobile}@bigwin.in`
  },

  order_meta: {
    notify_url: "https://color-game-backend1.onrender.com/api/cashfree/webhook",
    return_url: "https://color-game-frontend.pages.dev/wallet"
  }
};
const response = await Cashfree.PGCreateOrder("2023-08-01", request);
await Deposit.create({
mobile: user.mobile,
amount: Number(amount),
method: "cashfree",
referenceId: orderId,
status: "PENDING",
});
return res.json({
orderId,
payment_session_id: response.data.payment_session_id,
});
} catch (err) {
console.error("Cashfree error:", err);
return res.status(500).json({
message: "Cashfree order create failed",
error: err?.response?.data || err?.message || "Unknown error"
});
}
});
/* =========================
ROUND STATE
========================= */
let CURRENT_ROUND = {
id: Date.now().toString(),
startTime: Date.now()
};
/* =========================
BASIC
========================= */
app.get("/", (req, res) => {
res.send("BIGWIN backend running - All systems operational ✅");
}); /* =========================
AUTH – USER
========================= */
app.post('/register', async (req, res) => {
try {
const { mobile, password, referralCode } = req.body;
if (!mobile || !password) {
return res.status(400).json({ message: 'Mobile and password required' });
}
if (!/^[0-9]{10}$/.test(mobile)) {
return res.status(400).json({ message: 'Invalid mobile number. Must be 10 digits.' });
}
if (password.length < 6) {
return res.status(400).json({ message: 'Password must be at least 6 characters' });
}
const existing = await User.findOne({ mobile });
if (existing) {
return res.status(400).json({ message: 'Mobile number already registered' });
}
const generateReferralCode = () => {
return 'BW' + Math.random().toString(36).substring(2, 11).toUpperCase();
};
let uniqueCode = generateReferralCode();
let codeExists = await User.findOne({ referralCode: uniqueCode });
while (codeExists) {
uniqueCode = generateReferralCode();
codeExists = await User.findOne({ referralCode: uniqueCode });
}
let referrer = null;
if (referralCode) {
referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
if (!referrer) {
return res.status(400).json({ message: 'Invalid referral code' });
}
}
const newUser = new User({
  mobile,
password,
wallet: 0,
bonus: 100,
deposited: false,
depositAmount: 0,
totalWagered: 0,
referralCode: uniqueCode,
referredBy: referrer ? referrer.referralCode : null 
});
  await newUser.save();
if (referrer) {
referrer.totalReferrals += 1;
await referrer.save();
}
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
app.post("/login", async (req, res) => {
try {
let { mobile, password } = req.body;
if (!mobile || !password) {
return res.status(400).json({ error: "Mobile and password required" });
}
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
/* ========================= USER DATA
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
return res.status(404).json({ error: "User not found" });
}
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
BETS
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
app.get("/bets/current", auth, async (req, res) => { try {
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
/* =========================
BET ENDPOINT - FIXED
========================= */
app.post("/bet", auth, async (req, res) => {
const session = await mongoose.startSession();
try {
await session.startTransaction();
const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
if (elapsed >= 57) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Round closed for betting" });
}
const { color, amount } = req.body;
if (!color || !['red', 'green'].includes(color.toLowerCase())) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Invalid color. Choose red or green." });
}
if (!amount || amount < 1) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Minimum bet ₹1" });
}
const betAmount = Math.round(amount * 100) / 100;
const user = await User.findOne({ mobile: req.user.mobile }).session(session);
if (!user) {
await session.abortTransaction();
session.endSession();
return res.status(404).json({ error: "User not found" });
}
const existingBet = await Bet.findOne({
mobile: req.user.mobile,
roundId: CURRENT_ROUND.id
}).session(session);
if (existingBet) {
await session.abortTransaction(); session.endSession();
return res.status(400).json({
error: `Already placed bet: ₹${existingBet.amount} on ${existingBet.color.toUpperCase()}`
});
}
const totalBalance = (user.wallet || 0) + (user.bonus || 0);
if (totalBalance < betAmount) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({
error: `Insufficient balance. Available: ₹${totalBalance.toFixed(2)}`
});
}
let deductFromBonus = Math.min(user.bonus, betAmount);
let deductFromWallet = betAmount - deductFromBonus;
user.bonus = Math.round((user.bonus - deductFromBonus) * 100) / 100;
user.wallet = Math.round((user.wallet - deductFromWallet) * 100) / 100;
user.totalWagered = Math.round(((user.totalWagered || 0) + betAmount) * 100) / 100;
await user.save({ session });
await Bet.create([{
mobile: req.user.mobile,
roundId: CURRENT_ROUND.id,
color: color.toLowerCase(),
amount: betAmount,
status: 'PENDING',
createdAt: new Date()
}], { session });
const updateField = color.toLowerCase() === 'red' ? 'redPool' : 'greenPool';
let round = await Round.findOne({ roundId: CURRENT_ROUND.id }).session(session);
if (!round) {
console.log(`⚠️ Round ${CURRENT_ROUND.id} not found - Creating it now!`);
const created = await Round.create([{
roundId: CURRENT_ROUND.id,
redPool: 0,
greenPool: 0,
winner: null
}], { session });
round = created[0];
}
if (updateField === 'redPool') {
round.redPool = Math.round((round.redPool + betAmount) * 100) / 100;
} else {
round.greenPool = Math.round((round.greenPool + betAmount) * 100) / 100;
}
await round.save({ session });
console.log(`✅ Bet: ${req.user.mobile.substring(0,4)}**** - ₹${betAmount} on ${color.toUpperCase()} | Pools: R=₹${round.redPool} G=₹${round.greenPool}`); await session.commitTransaction();
session.endSession();
res.json({
message: "Bet placed successfully",
  roundId: CURRENT_ROUND.id,
betAmount: betAmount,
color: color.toLowerCase(),
newWallet: user.wallet,
newBonus: user.bonus
});
} catch (err) {
await session.abortTransaction();
session.endSession();
console.error("❌ BET ERROR:", err);
res.status(500).json({ error: "Bet failed. Please try again." });
}
});
/* =========================
ROUND PROCESSING - FIXED WITH RANDOM WINNER
========================= */
async function processRoundEnd(roundId) {
console.log(`\n🔔 START PROCESSING ROUND: ${roundId}`);
const session = await mongoose.startSession();
try {
await session.startTransaction();
console.log('✅ Transaction started');
console.log(`\n╔════════════════════════════════╗`);
console.log(`🎮 PROCESSING ROUND: ${roundId}`);
console.log(`╚════════════════════════════════╝`);
console.log('🔍 Searching for round in database...');
const round = await Round.findOne({ roundId }).session(session);
if (!round) {
console.error('❌ CRITICAL: Round not found in database:', roundId);
await session.abortTransaction();
session.endSession();
return;
}
console.log('✅ Round found in database');
if (round.winner !== null) {
console.log('⚠️ Round already processed with winner:', round.winner);
await session.abortTransaction();
session.endSession();
return;
}
const redPool = round.redPool || 0;
const greenPool = round.greenPool || 0;
const totalPool = redPool + greenPool;
console.log(`💰 RED POOL: ₹${redPool}`);
console.log(`💰 GREEN POOL: ₹${greenPool}`);
console.log(`💰 TOTAL POOL: ₹${totalPool}`);
let winner;
if (totalPool === 0) {
winner = Math.random() < 0.5 ? 'red' : 'green';
console.log('🎲 No bets - Random winner selected');
} else if (redPool === greenPool) {
winner = Math.random() < 0.5 ? 'red' : 'green';
console.log('⚖️ Equal pools - Random winner selected');
} else {
winner = redPool < greenPool ? 'red' : 'green';
console.log('📊 Different pools - Smaller pool wins');
}
console.log(`🏆 WINNER SELECTED: ${winner.toUpperCase()}`);
console.log('💾 Saving winner to database...');
round.winner = winner;
await round.save({ session });
console.log('✅ Winner saved successfully');
const bets = await Bet.find({
roundId,
status: 'PENDING'
}).session(session);
console.log(`📋 Found ${bets.length} pending bets to process`);
if (bets.length === 0) {
console.log('✅ No bets to process - Committing transaction...');
await session.commitTransaction();
session.endSession();
console.log('✅ Transaction committed successfully');
console.log(`✅ Round ${roundId} completed with winner: ${winner.toUpperCase()}\n`);
return;
}
let totalPayouts = 0;
let totalLosses = 0;
let processedCount = 0;
for (const bet of bets) {
const user = await User.findOne({ mobile: bet.mobile }).session(session);
if (!user) {
console.log(`⚠️ User not found: ${bet.mobile}`);
continue;
}
if (bet.color === winner) {
const winAmount = Math.round(bet.amount * 2 * 0.98 * 100) / 100;
user.wallet = Math.round((user.wallet + winAmount) * 100) / 100;
bet.status = 'WON';
bet.winAmount = winAmount;
totalPayouts += winAmount;
console.log(`✅ ${user.mobile.substring(0, 4)}**** WON ₹${winAmount}`); } else {
bet.status = 'LOST';
bet.winAmount = 0;
totalLosses += bet.amount;
console.log(`❌ ${user.mobile.substring(0, 4)}**** LOST ₹${bet.amount}`);
}
await user.save({ session });
await bet.save({ session });
processedCount++;
}
const houseProfit = totalLosses - totalPayouts;
console.log(`╔════════════════════════════════╗`);
console.log(`✅ Processed ${processedCount}/${bets.length} bets`);
console.log(`💸 Total Payouts: ₹${totalPayouts.toFixed(2)}`);
console.log(`💰 Total Losses: ₹${totalLosses.toFixed(2)}`);
console.log(`🏦 House Profit: ₹${houseProfit.toFixed(2)}`);
console.log(`╚════════════════════════════════╝\n`);
console.log('💾 Committing transaction...');
await session.commitTransaction();
console.log('✅ Transaction committed successfully');
session.endSession();
console.log('✅ Session ended');
console.log(`✅✅✅ Round ${roundId} FULLY PROCESSED - Winner: ${winner.toUpperCase()}\n`);
} catch (err) {
console.error('\n❌❌❌ CRITICAL ERROR IN ROUND PROCESSING ❌❌❌');
console.error('Error details:', err);
await session.abortTransaction();
session.endSession();
console.error('❌ Transaction aborted due to error\n');
}
}
/* =========================
ROUND TIMER - FIXED
========================= */
setInterval(async () => {
const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
if (elapsed >= 60) {
console.log('\n⏰ Round timer reached 60 seconds - Ending round...');
console.log(`⏰ Current round ID: ${CURRENT_ROUND.id}`);
await processRoundEnd(CURRENT_ROUND.id);
const newRoundId = Date.now().toString();
console.log(`\n🆕 Creating new round: ${newRoundId}`);
CURRENT_ROUND = {
id: newRoundId,
startTime: Date.now() };
try {
const newRound = await Round.create({
roundId: newRoundId,
redPool: 0,
greenPool: 0,
winner: null
});
console.log('✅ New round created in database');
console.log(`🆕 NEW ROUND STARTED: ${newRoundId}`);
console.log(`⏰ Next round will end in 60 seconds\n`);
} catch (err) {
console.error('❌❌❌ CRITICAL: Failed to create new round in database!');
console.error('Error:', err);
}
}
}, 1000);
/* =========================
INITIALIZE FIRST ROUND
========================= */
(async () => {
try {
console.log('\n🚀 Initializing game server...');
const existingRound = await Round.findOne({ roundId: CURRENT_ROUND.id });
if (!existingRound) {
await Round.create({
roundId: CURRENT_ROUND.id,
redPool: 0,
greenPool: 0,
winner: null
});
console.log('✅ First round created:', CURRENT_ROUND.id);
} else {
console.log('✅ Resuming existing round:', CURRENT_ROUND.id);
}
console.log('✅ Game server ready!\n');
} catch (err) {
console.error('❌ Round initialization error:', err);
}
})();
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
const deposit = await Deposit.create({
mobile: user.mobile,
amount,
method: "upi",
referenceId: referenceId || "AUTO",
status: "SUCCESS"
});
user.wallet = Math.round((user.wallet + amount) * 100) / 100;
user.deposited = true;
user.depositAmount = Math.round((user.depositAmount + amount) * 100) / 100;
const isFirstDeposit = user.depositAmount === amount;
if (isFirstDeposit) {
user.bonus = Math.round((user.bonus + amount) * 100) / 100;
}
await user.save();
await processReferralCommission(user.mobile, amount, "DEPOSIT");
console.log(`✅ Deposit: ${user.mobile} - ₹${amount} (First: ${isFirstDeposit})`);

res.json({
message: "Deposit successful",
newWallet: user.wallet,
newBonus: user.bonus,
deposit
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
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Minimum withdrawal ₹100" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user has set withdrawal method
    if (!user.withdrawMethod || !user.withdrawDetails) {
      return res.status(400).json({ 
        error: "Please set withdrawal method first" 
      });
    }

    // Check if user has sufficient balance
    if (user.wallet < amount) {
      return res.status(400).json({ 
        error: `Insufficient balance. Available: ₹${user.wallet.toFixed(2)}` 
      });
    }

    // Check if user has made a deposit
    if (!user.deposited) {
      return res.status(400).json({ 
        error: "You must make a deposit before withdrawing" 
      });
    }

    // Deduct amount from wallet
    user.wallet = Math.round((user.wallet - amount) * 100) / 100;
    await user.save();

    // Create withdrawal request
    const withdrawal = await Withdraw.create({
      mobile: user.mobile,
      amount: amount,
      method: user.withdrawMethod,
      details: user.withdrawDetails,
      status: "PENDING"
    });

    console.log(`✅ Withdrawal request: ${user.mobile} - ₹${amount} (${user.withdrawMethod})`);

    res.json({
      message: "Withdrawal request submitted successfully",
      withdrawal: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        method: withdrawal.method
      },
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
    const deposits = await Deposit.find({ mobile: req.user.mobile })
      .sort({ createdAt: -1 })
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
REFERRAL SYSTEM
========================= */
app.get("/referral/info", auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const directReferrals = await User.find({ referredBy: user.referralCode });

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

        await getAllReferrals(ref.referralCode, level + 1, allRefs);
      }

      return allRefs;
    };

    const allReferrals = await getAllReferrals(user.referralCode);

    const commissions = await Referral.find({ userId: user.mobile })
      .sort({ createdAt: -1 })
      .limit(50);

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

    return res.json({
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
    return res.status(500).json({ message: 'Error fetching referral data' });
  }
});
      /* =========================
ADMIN LOGIN
========================= */
app.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const ADMIN_USERNAME = "admin";
    const ADMIN_PASSWORD = "admin123";

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = jwt.sign(
        { username: username, role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log('✅ Admin logged in:', username);

      return res.json({
        message: "Admin login successful",
        token: `Bearer ${token}`
      });
    } else {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================
ADMIN ENDPOINTS
========================= */
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

      user.wallet = Math.round((user.wallet + deposit.amount) * 100) / 100;
      user.deposited = true;
      user.depositAmount = Math.round((user.depositAmount + deposit.amount) * 100) / 100;

      const isFirstDeposit = user.depositAmount === deposit.amount;
      if (isFirstDeposit) {
        user.bonus = Math.round((user.bonus + deposit.amount) * 100) / 100;
      }
await user.save();
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
      return res.status(404).json({ error: "User not found" });
    }

    if (action === "approve") {
      withdrawal.status = "APPROVED";
      withdrawal.adminNote = adminNote || "Approved";
      withdrawal.processedAt = new Date();
    } else if (action === "reject") {
      withdrawal.status = "REJECTED";
      withdrawal.adminNote = adminNote || "Rejected";
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

/* =========================
ENHANCED ADMIN ENDPOINTS
========================= */
app.get("/admin/dashboard-stats", adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const totalUsers = await User.countDocuments();
    const newUsersThisWeek = await User.countDocuments({
      createdAt: { $gte: lastWeek }
    });

    const totalDeposits = await Deposit.aggregate([
      { $match: { status: "SUCCESS" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const depositsThisWeek = await Deposit.aggregate([
      { $match: { status: "SUCCESS", createdAt: { $gte: lastWeek } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const totalWithdrawals = await Withdraw.aggregate([
      { $match: { status: "APPROVED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const pendingDeposits = await Deposit.countDocuments({ status: "PENDING" });
    const pendingWithdrawals = await Withdraw.countDocuments({ status: "PENDING" });

    const totalRevenue = totalDeposits[0]?.total || 0;
    const totalPayout = totalWithdrawals[0]?.total || 0;
    const netProfit = totalRevenue - totalPayout;

    res.json({
      totalUsers,
      newUsersThisWeek,
      totalRevenue,
      revenueThisWeek: depositsThisWeek[0]?.total || 0,
      netProfit,
      pendingActions: pendingDeposits + pendingWithdrawals,
      pendingDeposits,
      pendingWithdrawals
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/live-activity", adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const recentBets = await Bet.find()
      .sort({ createdAt: -1 })
      .limit(limit / 2)
      .lean();

    const recentDeposits = await Deposit.find()
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .lean();

    const recentWithdrawals = await Withdraw.find()
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .lean();

    const activities = [
      ...recentBets.map(b => ({
        type: 'bet',
        title: `Bet placed on ${b.color.toUpperCase()}`,
        user: b.mobile.substring(0, 4) + '****' + b.mobile.substring(8),
        amount: b.amount,
        time: b.createdAt
      })),
      ...recentDeposits.map(d => ({
        type: 'deposit',
        title: `Deposit ${d.status}`,
        user: d.mobile.substring(0, 4) + '****' + d.mobile.substring(8),
        amount: d.amount,
        time: d.createdAt
      })),
      ...recentWithdrawals.map(w => ({
        type: 'withdraw',
        title: `Withdrawal ${w.status}`,
        user: w.mobile.substring(0, 4) + '****' + w.mobile.substring(8),
        amount: w.amount,
        time: w.createdAt
      }))
    ]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, limit);

    res.json(activities);
  } catch (err) {
    console.error("Live activity error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/user-analytics", adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const depositedUsers = await User.countDocuments({ deposited: true });
    const activeUsers = await Bet.distinct('mobile', {
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    const topDepositors = await User.find()
      .sort({ depositAmount: -1 })
      .limit(10)
      .select('mobile depositAmount wallet totalWagered');

    const topWagerers = await User.find()
      .sort({ totalWagered: -1 })
      .limit(10)
      .select('mobile totalWagered depositAmount wallet');

    res.json({
      totalUsers,
      depositedUsers,
      activeUsersToday: activeUsers.length,
      conversionRate: ((depositedUsers / totalUsers) * 100).toFixed(2),
      topDepositors,
      topWagerers
    });
  } catch (err) {
    console.error("User analytics error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/game-analytics", adminAuth, async (req, res) => {
  try {
    const totalBets = await Bet.countDocuments();
    const totalWagered = await Bet.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const redBets = await Bet.countDocuments({ color: 'red' });
    const greenBets = await Bet.countDocuments({ color: 'green' });
    const wonBets = await Bet.countDocuments({ status: 'WON' });
    const lostBets = await Bet.countDocuments({ status: 'LOST' });

    const totalWinnings = await Bet.aggregate([
      { $match: { status: 'WON' } },
      { $group: { _id: null, total: { $sum: "$winAmount" } } }
    ]);

    const houseEdge = totalWagered[0]?.total - (totalWinnings[0]?.total || 0);

    res.json({
      totalBets,
      totalWagered: totalWagered[0]?.total || 0,
      redBetsPercentage: ((redBets / totalBets) * 100).toFixed(2),
      greenBetsPercentage: ((greenBets / totalBets) * 100).toFixed(2),
      winRate: ((wonBets / (wonBets + lostBets)) * 100).toFixed(2),
      houseEdge: houseEdge.toFixed(2),
      totalPayouts: totalWinnings[0]?.total || 0
    });
  } catch (err) {
    console.error("Game analytics error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/admin/user/:mobile/ban", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { banned, reason } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.banned = banned;
    if (banned) {
      user.banReason = reason || "Violation of terms";
    }
    await user.save();

    console.log(`Admin ${banned ? 'banned' : 'unbanned'} user: ${mobile}`);

    res.json({
      message: `User ${banned ? 'banned' : 'unbanned'} successfully`,
      user: {
        mobile: user.mobile,
        banned: user.banned
      }
    });
  } catch (err) {
    console.error("Ban user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/admin/user/:mobile/adjust-balance", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { amount, type, reason } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (type === 'wallet') {
      user.wallet = Math.max(0, Math.round((user.wallet + amount) * 100) / 100);
    } else if (type === 'bonus') {
      user.bonus = Math.max(0, Math.round((user.bonus + amount) * 100) / 100);
    } else {
      return res.status(400).json({ error: "Invalid type" });
    }

    await user.save();

    console.log(`Admin adjusted ${type}: ${mobile} ${amount > 0 ? '+' : ''}₹${amount} - ${reason}`);

    res.json({
      message: "Balance adjusted successfully",
      newWallet: user.wallet,
      newBonus: user.bonus
    });
  } catch (err) {
    console.error("Balance adjustment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

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
  console.log(`🏦 House Edge: 2%`);
  console.log(`🎁 Registration Bonus: ₹100 bonus`);
  console.log(`💰 Referral Levels: 6 (22% total commission)`);
  console.log('='.repeat(50) + '\n');
});
