require("dotenv").config();
require("./db");

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

/* ===== MODELS ===== */
const User = require("./models/User");
const Bet = require("./models/Bet");
const Round = require("./models/Round");
const Withdraw = require("./models/Withdraw");

/* ===== MIDDLEWARE ===== */
const auth = require("./middleware/auth");

const app = express();

/* ===== ADMIN CONFIG ===== */
const ADMIN_KEY = process.env.ADMIN_KEY || "bigwin_admin_123";

function adminAuth(req, res, next) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(403).json({ error: "Admin access denied" });
  }
  next();
}

/* ===== APP SETUP ===== */
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================
   🔁 ROUND STATE (GLOBAL)
========================= */
let CURRENT_ROUND = {
  id: Date.now().toString(),
  startTime: Date.now()
};

/* ========================= */

app.get("/", (req, res) => res.send("BIGWIN backend running"));

/* =========================
        AUTH
========================= */

app.post("/register", async (req, res) => {
  try {
    await User.create({
      mobile: req.body.mobile,
      password: req.body.password,
      wallet: 100,
      bonus: 100,
      deposited: false,
      depositAmount: 0,
      totalWagered: 0
    });

    res.json({ message: "Registered with ₹100 bonus" });
  } catch {
    res.status(400).json({ error: "User exists" });
  }
});

app.post("/login", async (req, res) => {
  const user = await User.findOne({
    mobile: req.body.mobile,
    password: req.body.password
  });

  if (!user) return res.status(401).json({ error: "Invalid" });

  const token = jwt.sign(
    { mobile: user.mobile },
    process.env.JWT_SECRET
  );

  res.json({ token, wallet: user.wallet });
});

/* =========================
        WALLET
========================= */

app.get("/wallet", auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.user.mobile });
  res.json({ wallet: u.wallet });
});

/* =========================
        PROFILE
========================= */

app.get("/profile", auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.user.mobile });
  res.json({
    mobile: u.mobile,
    wallet: u.wallet,
    totalWagered: u.totalWagered
  });
});

/* =========================
   WITHDRAW DETAILS
========================= */

app.get("/withdraw/details", auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.user.mobile });

  if (!u.withdrawMethod) {
    return res.json({ method: null });
  }

  res.json({
    method: u.withdrawMethod,
    details: u.withdrawDetails
  });
});

app.post("/withdraw/details", auth, async (req, res) => {
  const {
    method,
    upiId,
    bankName,
    accountNumber,
    ifsc,
    accountHolder,
    usdtAddress
  } = req.body;

  const u = await User.findOne({ mobile: req.user.mobile });

  if (!method) {
    return res.status(400).json({ error: "Withdraw method required" });
  }

  u.withdrawMethod = method;
  u.withdrawDetails = {};

  if (method === "upi") {
    if (!upiId) return res.status(400).json({ error: "UPI ID required" });
    u.withdrawDetails.upiId = upiId;
  }

  if (method === "bank") {
    if (!bankName || !accountNumber || !ifsc || !accountHolder) {
      return res.status(400).json({ error: "Complete bank details required" });
    }
    u.withdrawDetails = { bankName, accountNumber, ifsc, accountHolder };
  }

  if (method === "usdt") {
    if (!usdtAddress) {
      return res.status(400).json({ error: "USDT address required" });
    }
    u.withdrawDetails.usdtAddress = usdtAddress;
  }

  await u.save();
  res.json({ message: "Withdrawal details saved successfully" });
});

/* =========================
        BET HISTORY
========================= */

app.get("/bets", auth, async (req, res) => {
  const bets = await Bet.find({ mobile: req.user.mobile })
    .sort({ createdAt: -1 })
    .limit(10);

  res.json(bets);
});

/* =========================
        ROUND
========================= */

app.get("/round/current", (req, res) => {
  res.json(CURRENT_ROUND);
});

/* =========================
        BET
========================= */

app.post("/bet", auth, async (req, res) => {
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  if (elapsed >= 30) {
    return res.status(400).json({ error: "Round closed" });
  }

  const { color, amount } = req.body;
  const u = await User.findOne({ mobile: req.user.mobile });

  if (amount > u.wallet) {
    return res.status(400).json({ error: "No balance" });
  }

  u.wallet -= amount;
  u.totalWagered += amount;
  await u.save();

  await Bet.create({
    mobile: u.mobile,
    color,
    amount,
    roundId: CURRENT_ROUND.id
  });

  res.json({ message: "Bet placed" });
});

/* =========================
      RESOLVE ROUND
========================= */

app.post("/round/resolve", async (req, res) => {
  const bets = await Bet.find({ roundId: CURRENT_ROUND.id });

  let red = 0, green = 0;
  bets.forEach(b => {
    if (b.color === "red") red += b.amount;
    if (b.color === "green") green += b.amount;
  });

  const winner =
    red === green ? (Math.random() < 0.5 ? "red" : "green")
                  : red < green ? "red" : "green";

  for (const b of bets) {
    if (b.color === winner) {
      await User.updateOne(
        { mobile: b.mobile },
        { $inc: { wallet: b.amount * 2 * 0.98 } }
      );
    }
  }

  await Round.create({
    roundId: CURRENT_ROUND.id,
    redPool: red,
    greenPool: green,
    winner
  });

  CURRENT_ROUND = { id: Date.now().toString(), startTime: Date.now() };

  res.json({ winner, nextRoundId: CURRENT_ROUND.id });
});

/* =========================
        DEPOSIT
========================= */

app.post("/deposit", auth, async (req, res) => {
  const { amount } = req.body;
  if (amount < 100) {
    return res.status(400).json({ error: "Minimum deposit ₹100" });
  }

  const u = await User.findOne({ mobile: req.user.mobile });
  u.wallet += amount;
  u.deposited = true;
  u.depositAmount += amount;
  await u.save();

  res.json({ message: "Deposit successful", wallet: u.wallet });
});

/* =========================
        WITHDRAW
========================= */

app.post("/withdraw", auth, async (req, res) => {
  const { amount } = req.body;
  const u = await User.findOne({ mobile: req.user.mobile });

  if (amount < 100) return res.status(400).json({ error: "Minimum withdrawal ₹100" });
  if (!u.deposited) return res.status(400).json({ error: "Deposit required" });
  if (!u.withdrawMethod) {
    return res.status(400).json({ error: "Please add withdrawal details before withdrawing" });
  }

  const requiredWager = Math.max(u.bonus, u.depositAmount);
  if (u.totalWagered < requiredWager) {
    return res.status(400).json({
      error: `Wager ₹${requiredWager - u.totalWagered} more to withdraw`
    });
  }

  if (amount > u.wallet) return res.status(400).json({ error: "Insufficient balance" });

  await Withdraw.create({
    mobile: u.mobile,
    amount,
    method: u.withdrawMethod,
    details: u.withdrawDetails
  });

  u.wallet -= amount;
  await u.save();

  res.json({ message: "Withdrawal request submitted successfully" });
});

/* =========================
        ADMIN
========================= */

app.get("/admin/withdraws", adminAuth, async (req, res) => {
  const withdraws = await Withdraw.find().sort({ createdAt: -1 });
  res.json(withdraws);
});

app.post("/admin/withdraw/:id", adminAuth, async (req, res) => {
  const { status, adminNote } = req.body;

  // ✅ VALIDATE FIRST
  if (!["APPROVED", "REJECTED"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const withdraw = await Withdraw.findById(req.params.id);
  if (!withdraw) {
    return res.status(404).json({ error: "Withdraw request not found" });
  }

  if (withdraw.status !== "PENDING") {
    return res.status(400).json({ error: "Already processed" });
  }

  withdraw.status = status;
  withdraw.adminNote = adminNote || "";
  withdraw.processedAt = new Date();

  // 🔁 REFUND IF REJECTED
  if (status === "REJECTED") {
    await User.updateOne(
      { mobile: withdraw.mobile },
      { $inc: { wallet: withdraw.amount } }
    );
  }

  await withdraw.save();

  res.json({ message: `Withdraw ${status.toLowerCase()}` });
});
    

/* =========================
        START
========================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
