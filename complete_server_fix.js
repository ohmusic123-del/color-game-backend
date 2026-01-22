require("dotenv").config();
require("./db");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = express();
const { Cashfree } = require("cashfree-pg");
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
app.post("/api/cashfree/webhook", async (req, res) => {
  try {
    console.log("✅ Cashfree Webhook Received:", JSON.stringify(req.body));
    const eventData = req.body?.data;
    const orderId = eventData?.order?.order_id;
    const paymentStatus = eventData?.payment?.payment_status;
    const paidAmount = Number(eventData?.order?.order_amount || 0);

    if (!orderId) {
      return res.status(400).send("Missing order_id");
    }

    const deposit = await Deposit.findOne({ referenceId: orderId });
    
    if (!deposit) {
      console.log("⚠️ Deposit not found for order:", orderId);
      return res.status(200).send("OK");
    }

    if (deposit.status === "SUCCESS") {
      return res.status(200).send("OK");
    }

    if (paymentStatus === "SUCCESS") {
      const user = await User.findOne({ mobile: deposit.mobile });
      
      if (!user) {
        console.log("⚠️ User not found:", deposit.mobile);
        return res.status(200).send("OK");
      }

      deposit.status = "SUCCESS";
      await deposit.save();

      const amountToAdd = paidAmount || deposit.amount;
      user.wallet = Math.round((user.wallet + amountToAdd) * 100) / 100;
      user.deposited = true;
      user.depositAmount = Math.round(((user.depositAmount || 0) + amountToAdd) * 100) / 100;

      const isFirstDeposit = user.depositAmount === amountToAdd;
      if (isFirstDeposit) {
        user.bonus = Math.round(((user.bonus || 0) + amountToAdd) * 100) / 100;
      }

      await user.save();
      await processReferralCommission(user.mobile, amountToAdd, "DEPOSIT");

      console.log(`✅ Cashfree Deposit SUCCESS: ${user.mobile} +₹${amountToAdd}`);
    } else {
      deposit.status = "FAILED";
      await deposit.save();
      console.log(`❌ Cashfree Deposit FAILED: ${orderId}`);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Cashfree webhook error:", err);
    return res.status(200).send("OK");
  }
});
 app.post("/api/cashfree/create-order", auth, async (req, res) => {
try {
const { amount } = req.body;
if (!amount || Number(amount) < 10) {
return res.status(400).json({ message: "Minimum deposit ₹10" });
}
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) return res.status(404).json({ message: "User not found" });
const orderId = `ORDER_${Date.now()}`;
const request = {
order_amount: Number(amount),
order_currency: "INR",
order_id: orderId,
customer_details: {
customer_id: user.mobile,
customer_phone: user.mobile,
customer_email: user.email || "user@gmail.com",
},
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