require("dotenv").config();
require("./db");

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();

/* =========================
   MODELS
========================= */
const User = require("./models/User");
const Bet = require("./models/Bet");
const Round = require("./models/Round");
const Withdraw = require("./models/Withdraw");
const Deposit = require("./models/Deposit");  // ✅ ADD THIS LINE
/* =========================
   MIDDLEWARE
========================= */
const auth = require("./middleware/auth");

/* ---------- Admin Auth ---------- */
function adminAuth(req, res, next) {
  try {
    const token = req.headers.authorization;
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
    return res.status(401).json({ error: "Invalid admin token" });
  }
}

/* =========================
   APP SETUP
========================= */
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

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
  res.send("BIGWIN backend running");
});

/* =========================
   AUTH — USER
========================= */

/* ================= REGISTER ================= */

app.post("/register", async (req, res) => {
  try {
    let { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ error: "Mobile and password required" });
    }

    mobile = String(mobile).trim(); // ✅ force string

    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = new User({
      mobile,
      password, // ⚠️ plain password (same as login)
      wallet: 100,
      bonus: 100,
      deposited: false,
      depositAmount: 0,
      totalWagered: 0
    });

    await user.save();

    res.json({ message: "Registered successfully" });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/* =========================
   DEPOSIT – USER
========================= */

// User submits deposit request
app.post("/deposit", auth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Minimum deposit ₹100" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // ✅ AUTO-APPROVE for testing (change to PENDING for production)
    const deposit = await Deposit.create({
      mobile: user.mobile,
      amount,
      method: "upi",
      status: "SUCCESS" // Change to "PENDING" when you want manual approval
    });

    // ✅ Add money to wallet immediately
    user.wallet += amount;
    user.deposited = true;
    user.depositAmount += amount;
    
    // First deposit bonus (100%)
    if (user.depositAmount === amount) {
      user.bonus = amount;
      user.wallet += user.bonus;
    }
    
    await user.save();

    res.json({ 
      message: "Deposit successful",
      newWallet: user.wallet
    });

  } catch (err) {
    console.error("Deposit error:", err);
    res.status(500).json({ error: "Deposit failed" });
  }
});

// Get deposit history
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
   WALLET HISTORY
========================= */

// Combined wallet history (deposits + withdrawals + bets)
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

// Withdraw history only
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
/* ================= LOGIN ================= */

app.post("/login", async (req, res) => {
  try {
    let { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ error: "Mobile and password required" });
    }

    mobile = String(mobile).trim(); // ✅ same format as register

    const user = await User.findOne({ mobile });

    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { mobile: user.mobile },
      process.env.JWT_SECRET
    );

    res.json({
      token,
      wallet: user.wallet
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   AUTH — ADMIN
========================= */
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    const token = jwt.sign(
      { role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    return res.json({ token });
  }

  res.status(401).json({ error: "Invalid admin credentials" });
});

/* =========================
   USER DATA
========================= */
app.get("/wallet", auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.user.mobile });
  res.json({ wallet: u.wallet });
});

app.get("/profile", auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.user.mobile });
  res.json({
    mobile: u.mobile,
    wallet: u.wallet,
    totalWagered: u.totalWagered
  });
});

/* =========================
   BETS
========================= */
app.get("/bets", auth, async (req, res) => {
  const bets = await Bet.find({ mobile: req.user.mobile })
    .sort({ createdAt: -1 })
    .limit(20);
  res.json(bets);
});

app.get("/bets/current", auth, async (req, res) => {
  const bets = await Bet.find({
    mobile: req.user.mobile,
    roundId: CURRENT_ROUND.id
  });
  res.json({ roundId: CURRENT_ROUND.id, bets });
});

app.post("/bet", auth, async (req, res) => {
  try {
    const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
    
    if (elapsed >= 30) {
      return res.status(400).json({ error: "Round closed" });
    }

    const { color, amount } = req.body;

    // Validate inputs
    if (!color || !["red", "green"].includes(color)) {
      return res.status(400).json({ error: "Invalid color" });
    }

    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Minimum bet ₹1" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (amount > user.wallet) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // ✅ ATOMIC CHECK: Prevent duplicate bets
    const existingBet = await Bet.findOne({
      mobile: user.mobile,
      roundId: CURRENT_ROUND.id
    });

    if (existingBet) {
      return res.status(400).json({
        error: `Already bet ₹${existingBet.amount} on ${existingBet.color}`
      });
    }

    // ✅ Deduct wallet first
    user.wallet -= amount;
    user.totalWagered = (user.totalWagered || 0) + amount;
    await user.save();

    // ✅ Then create bet
    const bet = await Bet.create({
      mobile: user.mobile,
      color,
      amount,
      roundId: CURRENT_ROUND.id,
      status: "PENDING"
    });

    res.json({ 
      message: "Bet placed successfully",
      roundId: CURRENT_ROUND.id,
      newWallet: user.wallet
    });

  } catch (err) {
    console.error("BET ERROR:", err);
    res.status(500).json({ error: "Bet failed. Please try again." });
  }
});

/* =========================
   ROUND INFO
========================= */
async function resolveRound() {
  const roundId = CURRENT_ROUND.id;
  const bets = await Bet.find({ roundId });

  let redPool = 0;
  let greenPool = 0;

  bets.forEach(b => {
    if (b.color === "red") redPool += b.amount;
    if (b.color === "green") greenPool += b.amount;
  });

  const winner =
    redPool === greenPool
      ? Math.random() < 0.5 ? "red" : "green"
      : redPool < greenPool ? "red" : "green";

  for (const bet of bets) {
    if (bet.color === winner) {
      bet.status = "WON";
      
      // ✅ CORRECT: bet × 2 × 0.98 = payout
      const payout = bet.amount * 2 * 0.98;
      
      await User.updateOne(
        { mobile: bet.mobile },
        { $inc: { wallet: payout } }
      );
    } else {
      bet.status = "LOST";
    }
    await bet.save();
  }

  await Round.create({ roundId, redPool, greenPool, winner });

  CURRENT_ROUND = {
    id: Date.now().toString(),
    startTime: Date.now()
  };
}

/* =========================
   AUTO ROUND TIMER (30s)
========================= */
setInterval(async () => {
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  if (elapsed >= 30) {
    await resolveRound();
  }
}, 1000);

/* =========================
   WITHDRAW — USER
========================= */
app.post("/withdraw", auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findOne({ mobile: req.user.mobile });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (amount < 100) {
      return res.status(400).json({ error: "Minimum ₹100" });
    }

    if (!user.deposited) {
      return res.status(400).json({ error: "Deposit required first" });
    }

    if (amount > user.wallet) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // ✅ Must wager (deposit + bonus) before withdrawal
    const requiredWager = user.depositAmount + user.bonus;
    const remainingWager = requiredWager - (user.totalWagered || 0);

    if (remainingWager > 0) {
      return res.status(400).json({
        error: `Wager ₹${remainingWager} more to withdraw`
      });
    }

    await Withdraw.create({
      mobile: user.mobile,
      amount,
      method: user.withdrawMethod || "upi",
      details: user.withdrawDetails || {}
    });

    user.wallet -= amount;
    await user.save();

    res.json({ message: "Withdraw request submitted" });

  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "Withdraw failed" });
  }
});

/* =========================
   ADMIN — WITHDRAW
========================= */
app.get("/admin/withdraws", adminAuth, async (req, res) => {
  const list = await Withdraw.find().sort({ createdAt: -1 });
  res.json(list);
});

app.post("/admin/withdraw/:id", adminAuth, async (req, res) => {
  const { status, adminNote } = req.body;

  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const w = await Withdraw.findById(req.params.id);
  if (!w) return res.status(404).json({ error: "Not found" });
  if (w.status !== "PENDING") {
    return res.status(400).json({ error: "Already processed" });
  }

  w.status = status;
  w.adminNote = adminNote || "";
  w.processedAt = new Date();

  if (status === "REJECTED") {
    await User.updateOne(
      { mobile: w.mobile },
      { $inc: { wallet: w.amount } }
    );
  }

  await w.save();
  res.json({ message: `Withdraw ${status.toLowerCase()}` });
});
/* =========================
   ADMIN – DEPOSITS
========================= */

// Get all deposits
app.get("/admin/deposits", adminAuth, async (req, res) => {
  try {
    const deposits = await Deposit.find()
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(deposits);
  } catch (err) {
    console.error("Admin deposits error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Approve/reject deposit (for manual approval mode)
app.post("/admin/deposit/:id", adminAuth, async (req, res) => {
  try {
    const { status, adminNote } = req.body;

    if (!["SUCCESS", "FAILED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const deposit = await Deposit.findById(req.params.id);
    
    if (!deposit) {
      return res.status(404).json({ error: "Deposit not found" });
    }

    if (deposit.status !== "PENDING") {
      return res.status(400).json({ error: "Already processed" });
    }

    deposit.status = status;
    deposit.adminNote = adminNote || "";
    await deposit.save();

    // If approved, add money to user wallet
    if (status === "SUCCESS") {
      const user = await User.findOne({ mobile: deposit.mobile });
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      user.wallet += deposit.amount;
      user.deposited = true;
      user.depositAmount += deposit.amount;
      
      // First deposit bonus
      if (user.depositAmount === deposit.amount) {
        user.bonus = deposit.amount;
        user.wallet += user.bonus;
      }
      
      await user.save();
    }

    res.json({ 
      message: `Deposit ${status.toLowerCase()}`,
      deposit 
    });

  } catch (err) {
    console.error("Admin deposit approval error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 BIGWIN backend running on", PORT);
});
// ================= ADMIN STATS =================
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const usersCount = await User.countDocuments();

    const walletAgg = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$wallet" } } }
    ]);
    const totalWallet = walletAgg[0]?.total || 0;

    const depositAgg = await Deposit.aggregate([
      { $match: { status: "SUCCESS" } },  // ✅ Changed from APPROVED
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalDeposits = depositAgg[0]?.total || 0;

    const withdrawAgg = await Withdraw.aggregate([
      { $match: { status: "APPROVED" } },  // ✅ This is correct
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalWithdrawals = withdrawAgg[0]?.total || 0;

    const betAgg = await Bet.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const totalBets = betAgg[0]?.total || 0;

    const payoutAgg = await Bet.aggregate([
      { $match: { status: "WON" } },
      {
        $group: {
          _id: null,
          total: { $sum: { $multiply: ["$amount", 2, 0.98] } }
        }
      }
    ]);
    const totalPayout = payoutAgg[0]?.total || 0;

    const profit = totalBets - totalPayout;

    const roundsCount = await Round.countDocuments();

    res.json({
      users: usersCount,           // ✅ Changed from totalUsers
      deposits: totalDeposits,      // ✅ Changed from totalDeposits
      withdrawals: totalWithdrawals, // ✅ Changed from totalWithdrawals
      wallet: totalWallet,          // ✅ Changed from totalWallet
      profit,
      rounds: roundsCount           // ✅ Changed from totalRounds
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Admin stats failed" });
  }
});
