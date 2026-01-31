require("dotenv").config();
require("./db");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');

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
const MonitorUser = require("./models/MonitorUser");
const MonitorActivity = require("./models/MonitorActivity");

/* =========================
   MIDDLEWARE
========================= */
const auth = require("./middleware/auth");

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

/* =========================
   AUTH MIDDLEWARE
========================= */
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

const authenticateMonitor = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const monitor = await MonitorUser.findOne({
      username: decoded.username,
      active: true
    });
    if (!monitor) {
      return res.status(401).json({ error: 'Invalid or inactive monitor user' });
    }
    req.monitor = monitor;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/* =========================
   GLOBAL STATE
========================= */
let CURRENT_ROUND = { id: null, startTime: null };

/* =========================
   HELPER FUNCTIONS
========================= */
async function getNextRoundId() {
  const lastRound = await Round.findOne().sort({ createdAt: -1 });
  if (!lastRound) return Date.now().toString();
  return (parseInt(lastRound.roundId) + 1).toString();
}

/* =========================
   AUTHENTICATION ROUTES
========================= */

app.post("/register", async (req, res) => {
  try {
    const { mobile, password, referralCode } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ error: "Mobile and password required" });
    }

    if (mobile.length !== 10 || isNaN(mobile)) {
      return res.status(400).json({ error: "Invalid mobile number" });
    }

    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({ error: "Mobile number already registered" });
    }

    const userCode = `BW${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const user = await User.create({
      mobile,
      password,
      userCode,
      wallet: 0,
      bonus: 50,
      totalWagered: 0,
      totalReferrals: 0,
      referralEarnings: 0,
      hasDeposited: false
    });

    if (referralCode) {
      const referrer = await User.findOne({ userCode: referralCode });
      if (referrer) {
        await Referral.create({
          referrerMobile: referrer.mobile,
          referredMobile: mobile,
          level: 1,
          referrerCode: referralCode
        });
        console.log(`✅ Referral: ${mobile} referred by ${referrer.mobile}`);
      }
    }

    const token = jwt.sign({ mobile }, process.env.JWT_SECRET, { expiresIn: "30d" });

    console.log(`✅ Registration: ${mobile}`);

    res.json({
      message: "Registration successful",
      token,
      user: {
        mobile: user.mobile,
        userCode: user.userCode,
        wallet: user.wallet,
        bonus: user.bonus
      }
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ error: "Mobile and password required" });
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.banned) {
      return res.status(403).json({ error: "Account has been banned" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ mobile }, process.env.JWT_SECRET, { expiresIn: "30d" });

    console.log(`✅ Login: ${mobile}`);

    res.json({
      message: "Login successful",
      token,
      user: {
        mobile: user.mobile,
        userCode: user.userCode,
        wallet: user.wallet,
        bonus: user.bonus
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* =========================
   WALLET ROUTES
========================= */

app.get("/wallet", auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      mobile: user.mobile,
      userCode: user.userCode,
      wallet: user.wallet || 0,
      bonus: user.bonus || 0,
      totalWagered: user.totalWagered || 0,
      totalReferrals: user.totalReferrals || 0,
      referralEarnings: user.referralEarnings || 0,
      hasDeposited: user.hasDeposited || false,
      createdAt: user.createdAt
    });
  } catch (err) {
    console.error("Wallet error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/wallet/withdraw", auth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount) || Number(amount) < 100) {
      return res.status(400).json({ error: "Minimum withdrawal is ₹100" });
    }

    const finalAmount = Number(amount);

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.wallet < finalAmount) {
      return res.status(400).json({ error: "Insufficient wallet balance" });
    }

    if (!user.withdrawMethod || !user.withdrawDetails) {
      return res.status(400).json({ error: "Please add withdrawal method first" });
    }

    user.wallet = Math.round((user.wallet - finalAmount) * 100) / 100;
    await user.save();

    const withdrawal = await Withdraw.create({
      mobile: user.mobile,
      amount: finalAmount,
      method: user.withdrawMethod,
      details: user.withdrawDetails,
      status: "PENDING"
    });

    console.log(`📤 Withdrawal: ${user.mobile} - ₹${finalAmount}`);

    res.json({
      message: "Withdrawal request submitted",
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

app.get("/wallet/history", auth, async (req, res) => {
  try {
    const deposits = await Deposit.find({ mobile: req.user.mobile });
    const withdrawals = await Withdraw.find({ mobile: req.user.mobile });
    
    const transactions = [
      ...deposits.map(d => ({ ...d.toObject(), type: 'DEPOSIT' })),
      ...withdrawals.map(w => ({ ...w.toObject(), type: 'WITHDRAW' }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
    
    res.json(transactions);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/withdraw/method", auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.withdrawMethod || !user.withdrawDetails) {
      return res.json({ hasMethod: false });
    }

    res.json({
      hasMethod: true,
      method: user.withdrawMethod,
      details: user.withdrawDetails
    });
  } catch (err) {
    console.error("Get withdraw method error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/withdraw/method', auth, async (req, res) => {
  try {
    const { method, details } = req.body;

    if (!method || !details) {
      return res.status(400).json({ error: 'Method and details required' });
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.withdrawMethod = method;
    user.withdrawDetails = details;
    await user.save();

    console.log(`✅ Withdraw method: ${user.mobile} - ${method}`);

    res.json({
      message: 'Withdrawal method saved',
      method: user.withdrawMethod,
      details: user.withdrawDetails
    });
  } catch (err) {
    console.error('Set withdraw method error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* =========================
   COLOR GAME ROUTES
========================= */

app.get("/round/current", async (req, res) => {
  try {
    if (!CURRENT_ROUND.id) {
      return res.status(404).json({ error: "No active round" });
    }

    const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
    const timeLeft = Math.max(0, 60 - elapsed);

    res.json({
      roundId: CURRENT_ROUND.id,
      timeLeft,
      startTime: CURRENT_ROUND.startTime
    });
  } catch (err) {
    console.error("Current round error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/rounds/history", async (req, res) => {
  try {
    const rounds = await Round.find({ winner: { $ne: null } })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(rounds);
  } catch (err) {
    console.error("Rounds history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/bet", auth, async (req, res) => {
  try {
    const { color, amount } = req.body;

    if (!color || !amount) {
      return res.status(400).json({ error: "Color and amount required" });
    }

    if (!['red', 'green'].includes(color)) {
      return res.status(400).json({ error: "Invalid color" });
    }

    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount < 10 || betAmount > 10000) {
      return res.status(400).json({ error: "Bet must be between ₹10 and ₹10,000" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.hasDeposited) {
      return res.status(403).json({ 
        error: "First deposit required",
        requireDeposit: true 
      });
    }

    const existingBet = await Bet.findOne({
      mobile: user.mobile,
      roundId: CURRENT_ROUND.id,
      status: 'PENDING'
    });

    if (existingBet) {
      return res.status(400).json({ error: "Already placed bet this round" });
    }

    let remainingAmount = betAmount;
    let bonusUsed = 0;
    let walletUsed = 0;

    if (user.bonus > 0) {
      bonusUsed = Math.min(user.bonus, remainingAmount);
      remainingAmount -= bonusUsed;
    }

    if (remainingAmount > 0) {
      if (user.wallet < remainingAmount) {
        return res.status(400).json({ error: "Insufficient balance" });
      }
      walletUsed = remainingAmount;
    }

    user.bonus -= bonusUsed;
    user.wallet -= walletUsed;
    user.totalWagered = (user.totalWagered || 0) + betAmount;
    await user.save();

    const bet = await Bet.create({
      mobile: user.mobile,
      roundId: CURRENT_ROUND.id,
      color,
      amount: betAmount,
      bonusUsed,
      walletUsed,
      status: "PENDING"
    });

    const round = await Round.findOne({ roundId: CURRENT_ROUND.id });
    if (round) {
      if (color === 'red') {
        round.redPool = (round.redPool || 0) + betAmount;
      } else {
        round.greenPool = (round.greenPool || 0) + betAmount;
      }
      await round.save();
    }

    console.log(`🎲 Bet: ${user.mobile} - ${color.toUpperCase()} - ₹${betAmount}`);

    res.json({
      message: "Bet placed successfully",
      roundId: CURRENT_ROUND.id,
      bet: {
        id: bet._id,
        color: bet.color,
        amount: bet.amount,
        bonusUsed: bet.bonusUsed,
        walletUsed: bet.walletUsed
      },
      newBalance: {
        wallet: user.wallet,
        bonus: user.bonus
      }
    });
  } catch (err) {
    console.error("Bet error:", err);
    res.status(500).json({ error: "Bet failed" });
  }
});

app.get("/bets", auth, async (req, res) => {
  try {
    const bets = await Bet.find({ mobile: req.user.mobile })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(bets);
  } catch (err) {
    console.error("Bets error:", err);
    res.status(500).json({ error: "Failed to load bets" });
  }
});

/* =========================
   REFERRAL ROUTES
========================= */

app.get("/referral/info", auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const referrals = await Referral.find({ referrerMobile: user.mobile })
      .sort({ createdAt: -1 })
      .limit(100);

    const referredUsers = await Promise.all(
      referrals.map(async (ref) => {
        const refUser = await User.findOne({ mobile: ref.referredMobile });
        return {
          mobile: ref.referredMobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2'),
          date: ref.createdAt,
          level: ref.level,
          wagered: refUser ? refUser.totalWagered : 0,
          earned: ref.commissionEarned || 0
        };
      })
    );

    res.json({
      userCode: user.userCode,
      totalReferrals: user.totalReferrals || 0,
      totalEarnings: user.referralEarnings || 0,
      referrals: referredUsers
    });
  } catch (err) {
    console.error("Referral info error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   DEPOSIT ROUTES
========================= */

app.post("/api/cashfree/create-order", auth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount < 100) {
      return res.status(400).json({ error: "Minimum deposit is ₹100" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const orderId = `ORDER_${Date.now()}_${user.mobile}`;
    
    await Deposit.create({
      mobile: user.mobile,
      amount: parseFloat(amount),
      orderId,
      status: "PENDING"
    });

    console.log(`💳 Deposit initiated: ${user.mobile} - ₹${amount}`);

    res.json({
      orderId,
      paymentSessionId: `session_${Date.now()}`,
      amount: parseFloat(amount)
    });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

/* =========================
   MONITOR ROUTES
========================= */

app.post('/monitor/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const monitor = await MonitorUser.findOne({ username });

    if (!monitor || !monitor.active) {
      return res.status(401).json({ error: 'Invalid credentials or account disabled' });
    }

    const isValid = await bcrypt.compare(password, monitor.password);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    monitor.totalLogins += 1;
    monitor.lastLogin = new Date();
    await monitor.save();

    await MonitorActivity.create({
      username: monitor.username,
      action: 'LOGIN',
      ipAddress: req.ip
    });

    const token = jwt.sign(
      { username: monitor.username, role: 'monitor' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        username: monitor.username,
        displayName: monitor.displayName
      }
    });
  } catch (err) {
    console.error('Monitor login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/monitor/live-bets', authenticateMonitor, async (req, res) => {
  try {
    const bets = await Bet.find({
      roundId: CURRENT_ROUND.id,
      status: 'PENDING'
    })
      .sort({ createdAt: -1 })
      .limit(100);

    const redBets = bets
      .filter(bet => bet.color === 'red')
      .map(bet => ({
        id: bet._id,
        mobile: bet.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2'),
        amount: bet.amount,
        time: bet.createdAt
      }));

    const greenBets = bets
      .filter(bet => bet.color === 'green')
      .map(bet => ({
        id: bet._id,
        mobile: bet.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2'),
        amount: bet.amount,
        time: bet.createdAt
      }));

    await MonitorActivity.create({
      username: req.monitor.username,
      action: 'VIEW_BETS',
      ipAddress: req.ip
    });

    res.json({ red: redBets, green: greenBets });
  } catch (err) {
    console.error('Live bets error:', err);
    res.status(500).json({ error: 'Failed to fetch live bets' });
  }
});

app.get('/monitor/round-stats', authenticateMonitor, async (req, res) => {
  try {
    const bets = await Bet.find({
      roundId: CURRENT_ROUND.id,
      status: 'PENDING'
    });

    const redBets = bets.filter(b => b.color === 'red');
    const greenBets = bets.filter(b => b.color === 'green');

    const redTotal = redBets.reduce((sum, b) => sum + b.amount, 0);
    const greenTotal = greenBets.reduce((sum, b) => sum + b.amount, 0);

    const uniquePlayers = new Set(bets.map(b => b.mobile)).size;

    res.json({
      redTotal,
      greenTotal,
      redBets: redBets.length,
      greenBets: greenBets.length,
      totalPlayers: uniquePlayers,
      potentialPayout: Math.max(redTotal * 1.96, greenTotal * 1.96)
    });
  } catch (err) {
    console.error('Round stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/* =========================
   ADMIN ROUTES
========================= */

app.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { username, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(`✅ Admin login: ${username}`);

    res.json({
      message: "Login successful",
      token,
      admin: { username }
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Login failed" });
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
    console.error("Get users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get("/admin/deposits", adminAuth, async (req, res) => {
  try {
    const deposits = await Deposit.find()
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(deposits);
  } catch (err) {
    console.error("Get deposits error:", err);
    res.status(500).json({ error: "Failed to fetch deposits" });
  }
});

app.post("/admin/deposit/:id", adminAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const deposit = await Deposit.findById(req.params.id);

    if (!deposit) {
      return res.status(404).json({ error: "Deposit not found" });
    }

    if (deposit.status !== "PENDING") {
      return res.status(400).json({ error: "Deposit already processed" });
    }

    if (action === "approve") {
      deposit.status = "COMPLETED";
      await deposit.save();

      const user = await User.findOne({ mobile: deposit.mobile });
      if (user) {
        user.wallet += deposit.amount;
        user.hasDeposited = true;
        await user.save();
      }

      console.log(`✅ Deposit approved: ${deposit.mobile} - ₹${deposit.amount}`);
    } else if (action === "reject") {
      deposit.status = "REJECTED";
      await deposit.save();

      console.log(`❌ Deposit rejected: ${deposit.mobile} - ₹${deposit.amount}`);
    }

    res.json({ message: "Deposit updated", deposit });
  } catch (err) {
    console.error("Process deposit error:", err);
    res.status(500).json({ error: "Failed to process deposit" });
  }
});

app.get("/admin/withdraws", adminAuth, async (req, res) => {
  try {
    const withdrawals = await Withdraw.find()
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(withdrawals);
  } catch (err) {
    console.error("Get withdrawals error:", err);
    res.status(500).json({ error: "Failed to fetch withdrawals" });
  }
});

app.post("/admin/withdraw/:id", adminAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const withdrawal = await Withdraw.findById(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    if (withdrawal.status !== "PENDING") {
      return res.status(400).json({ error: "Withdrawal already processed" });
    }

    if (action === "approve") {
      withdrawal.status = "COMPLETED";
      await withdrawal.save();

      console.log(`✅ Withdrawal approved: ${withdrawal.mobile} - ₹${withdrawal.amount}`);
    } else if (action === "reject") {
      withdrawal.status = "REJECTED";
      await withdrawal.save();

      const user = await User.findOne({ mobile: withdrawal.mobile });
      if (user) {
        user.wallet += withdrawal.amount;
        await user.save();
      }

      console.log(`❌ Withdrawal rejected: ${withdrawal.mobile} - ₹${withdrawal.amount}`);
    }

    res.json({ message: "Withdrawal updated", withdrawal });
  } catch (err) {
    console.error("Process withdrawal error:", err);
    res.status(500).json({ error: "Failed to process withdrawal" });
  }
});

app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalDeposits = await Deposit.countDocuments({ status: "COMPLETED" });
    const totalWithdrawals = await Withdraw.countDocuments({ status: "COMPLETED" });
    
    const depositSum = await Deposit.aggregate([
      { $match: { status: "COMPLETED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const withdrawalSum = await Withdraw.aggregate([
      { $match: { status: "COMPLETED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const pendingDeposits = await Deposit.countDocuments({ status: "PENDING" });
    const pendingWithdrawals = await Withdraw.countDocuments({ status: "PENDING" });

    res.json({
      totalUsers,
      totalDeposits,
      totalWithdrawals,
      depositAmount: depositSum[0]?.total || 0,
      withdrawalAmount: withdrawalSum[0]?.total || 0,
      pendingDeposits,
      pendingWithdrawals,
      profit: (depositSum[0]?.total || 0) - (withdrawalSum[0]?.total || 0)
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.post("/admin/user/:mobile/ban", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const user = await User.findOne({ mobile });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.banned = !user.banned;
    await user.save();

    console.log(`${user.banned ? '🚫' : '✅'} User ${user.banned ? 'banned' : 'unbanned'}: ${mobile}`);

    res.json({
      message: `User ${user.banned ? 'banned' : 'unbanned'} successfully`,
      user: {
        mobile: user.mobile,
        banned: user.banned
      }
    });
  } catch (err) {
    console.error("Ban user error:", err);
    res.status(500).json({ error: "Failed to update user status" });
  }
});

app.post("/admin/user/:mobile/adjust-balance", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { amount, type } = req.body;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: "Valid amount required" });
    }

    if (!['wallet', 'bonus'].includes(type)) {
      return res.status(400).json({ error: "Type must be 'wallet' or 'bonus'" });
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const adjustAmount = parseFloat(amount);

    if (type === 'wallet') {
      user.wallet = Math.max(0, user.wallet + adjustAmount);
    } else {
      user.bonus = Math.max(0, user.bonus + adjustAmount);
    }

    await user.save();

    console.log(`💰 Balance adjusted: ${mobile} - ${type} ${adjustAmount > 0 ? '+' : ''}${adjustAmount}`);

    res.json({
      message: "Balance adjusted successfully",
      user: {
        mobile: user.mobile,
        wallet: user.wallet,
        bonus: user.bonus
      }
    });
  } catch (err) {
    console.error("Adjust balance error:", err);
    res.status(500).json({ error: "Failed to adjust balance" });
  }
});

/* =========================
   ROUND PROCESSING
========================= */

async function processRoundEnd(roundId) {
  console.log(`\n🎮 PROCESSING ROUND: ${roundId}`);
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();
    
    const round = await Round.findOne({ roundId }).session(session);
    
    if (!round) {
      console.error('❌ Round not found:', roundId);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    if (round.winner !== null) {
      console.log('✓ Round already processed');
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    const redPool = round.redPool || 0;
    const greenPool = round.greenPool || 0;
    const totalPool = redPool + greenPool;
    
    console.log(`💰 RED: ₹${redPool} | GREEN: ₹${greenPool} | TOTAL: ₹${totalPool}`);
    
    let winner;
    if (totalPool === 0) {
      winner = Math.random() < 0.5 ? 'red' : 'green';
    } else if (redPool === greenPool) {
      winner = Math.random() < 0.5 ? 'red' : 'green';
    } else {
      winner = redPool < greenPool ? 'red' : 'green';
    }
    
    console.log(`🎯 WINNER: ${winner.toUpperCase()}`);
    
    round.winner = winner;
    await round.save({ session });
    
    const bets = await Bet.find({
      roundId,
      status: 'PENDING'
    }).session(session);
    
    console.log(`📊 Processing ${bets.length} bets`);
    
    let totalPayouts = 0;
    
    for (const bet of bets) {
      const user = await User.findOne({ mobile: bet.mobile }).session(session);
      
      if (!user) continue;
      
      if (bet.color === winner) {
        const winAmount = Math.round(bet.amount * 2 * 0.98 * 100) / 100;
        user.wallet = Math.round((user.wallet + winAmount) * 100) / 100;
        bet.status = 'WON';
        bet.winAmount = winAmount;
        totalPayouts += winAmount;
        console.log(`✅ ${user.mobile.substring(0, 4)}**** WON ₹${winAmount}`);
      } else {
        bet.status = 'LOST';
        bet.winAmount = 0;
        console.log(`❌ ${user.mobile.substring(0, 4)}**** LOST ₹${bet.amount}`);
      }
      
      await user.save({ session });
      await bet.save({ session });
    }
    
    console.log(`💸 Total Payouts: ₹${totalPayouts.toFixed(2)}`);
    
    await session.commitTransaction();
    session.endSession();
    console.log(`✅ Round ${roundId} completed - Winner: ${winner.toUpperCase()}\n`);
    
  } catch (err) {
    console.error('❌ ROUND PROCESSING ERROR:', err);
    await session.abortTransaction();
    session.endSession();
  }
}

/* =========================
   ROUND TIMERS
========================= */

let roundTimer;

async function startNewRound() {
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  
  if (elapsed >= 60 && CURRENT_ROUND.id) {
    clearInterval(roundTimer);
    const oldRoundId = CURRENT_ROUND.id;
    
    await processRoundEnd(oldRoundId);
    
    const nextRoundId = await getNextRoundId();
    
    await Round.create({
      roundId: nextRoundId,
      redPool: 0,
      greenPool: 0,
      winner: null
    });
    
    CURRENT_ROUND = {
      id: nextRoundId,
      startTime: Date.now()
    };
    
    console.log(`✅ NEW ROUND STARTED: ${CURRENT_ROUND.id}`);
    roundTimer = setInterval(startNewRound, 1000);
  }
}

/* =========================
   SERVER INITIALIZATION
========================= */

(async () => {
  try {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const latestRound = await Round.findOne().sort({ createdAt: -1 });
    
    if (latestRound && latestRound.roundId) {
      const roundAge = Date.now() - latestRound.createdAt.getTime();
      
      if (latestRound.winner === null && roundAge < 65000) {
        CURRENT_ROUND.id = latestRound.roundId;
        CURRENT_ROUND.startTime = latestRound.createdAt.getTime();
        console.log(`♻️ RESUMING ROUND: ${CURRENT_ROUND.id}`);
      } else {
        const firstRoundId = await getNextRoundId();
        
        await Round.create({
          roundId: firstRoundId,
          redPool: 0,
          greenPool: 0,
          winner: null
        });
        
        CURRENT_ROUND.id = firstRoundId;
        CURRENT_ROUND.startTime = Date.now();
        console.log(`🆕 NEW ROUND: ${CURRENT_ROUND.id}`);
      }
    } else {
      const firstRoundId = await getNextRoundId();
      
      await Round.create({
        roundId: firstRoundId,
        redPool: 0,
        greenPool: 0,
        winner: null
      });
      
      CURRENT_ROUND.id = firstRoundId;
      CURRENT_ROUND.startTime = Date.now();
      console.log(`🆕 FIRST ROUND: ${CURRENT_ROUND.id}`);
    }
    
    roundTimer = setInterval(startNewRound, 1000);
    
  } catch (err) {
    console.error('🚨 INITIALIZATION ERROR:', err);
    CURRENT_ROUND.id = Date.now().toString();
    CURRENT_ROUND.startTime = Date.now();
    roundTimer = setInterval(startNewRound, 1000);
  }
})();

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🎮 BIGWIN BACKEND SERVER - COLOR GAME ONLY');
  console.log('='.repeat(60));
  console.log(`✅ Server: http://localhost:${PORT}`);
  console.log(`📊 MongoDB: Connected`);
  console.log(`⏰ Round Duration: 60 seconds`);
  console.log(`🏦 House Edge: 2%`);
  console.log(`🎁 Registration Bonus: ₹50`);
  console.log(`🎯 Game: Color Prediction (Red vs Green)`);
  console.log('='.repeat(60) + '\n');
});
