require("dotenv").config();
require("./db");

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

/* ===== APP INIT (MUST BE FIRST) ===== */
const app = express();

/* ===== MODELS ===== */
const User = require("./models/User");
const Bet = require("./models/Bet");
const Round = require("./models/Round");
const Withdraw = require("./models/Withdraw");

/* ===== MIDDLEWARE ===== */
const auth = require("./middleware/auth");

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

/* =========================
        BASIC
========================= */
app.get("/", (req, res) => {
  res.send("BIGWIN backend running");
});

/* =========================
   ROUND HISTORY (LAST 20)
========================= */
app.get("/rounds/history", async (req, res) => {
  const rounds = await Round.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .select("roundId winner createdAt");

  res.json(rounds);
});

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

  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { mobile: user.mobile },
    process.env.JWT_SECRET
  );

  res.json({ token, wallet: user.wallet });
});

/* =========================
        WALLET / PROFILE
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
        BET HISTORY (USER)
========================= */
app.get("/bets", auth, async (req, res) => {
  const bets = await Bet.find({ mobile: req.user.mobile })
    .sort({ createdAt: -1 })
    .limit(20);

  res.json(bets);
});

/* =========================
        ROUND
========================= */
app.get("/round/current", (req, res) => {
  res.json(CURRENT_ROUND);
});
/* =========================
   CURRENT ROUND USER BETS
========================= */
app.get("/bets/current", auth, async (req, res) => {
  const bets = await Bet.find({
    mobile: req.user.mobile,
    roundId: CURRENT_ROUND.id
  }).sort({ createdAt: -1 });

  res.json({
    roundId: CURRENT_ROUND.id,
    bets
  });
});
/* =========================
        PLACE BET
========================= */
app.post("/bet", auth, async (req, res) => {
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  if (elapsed >= 30) {
    return res.status(400).json({ error: "Round closed" });
  }

  const { color, amount } = req.body;
  const u = await User.findOne({ mobile: req.user.mobile });

  if (amount > u.wallet) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  u.wallet -= amount;
  u.totalWagered += amount;
  await u.save();

  await Bet.create({
    mobile: u.mobile,
    color,
    amount,
    roundId: CURRENT_ROUND.id,
    status: "PENDING"
  });

  res.json({ message: "Bet placed", roundId: CURRENT_ROUND.id });
});

/* =========================
        RESOLVE ROUND
========================= */
app.post("/round/resolve", async (req, res) => {
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
      await User.updateOne(
        { mobile: bet.mobile },
        { $inc: { wallet: bet.amount * 2 * 0.98 } }
      );
    } else {
      bet.status = "LOST";
    }
    await bet.save();
  }

  await Round.create({
    roundId,
    redPool,
    greenPool,
    winner
  });

  CURRENT_ROUND = {
    id: Date.now().toString(),
    startTime: Date.now()
  };

  res.json({ roundId, winner, nextRoundId: CURRENT_ROUND.id });
});

/* =========================
        ADMIN
========================= */
app.get("/admin/withdraws", adminAuth, async (req, res) => {
  const withdraws = await Withdraw.find().sort({ createdAt: -1 });
  res.json(withdraws);
});

/* =========================
        START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
