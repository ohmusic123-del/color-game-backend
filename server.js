require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const User = require("./models/User");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= DB ================= */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ Mongo error:", err));

/* =========================
   MODELS
========================= */
const User = require("./models/User");
const Bet = require("./models/Bet");
const Round = require("./models/Round");
const Withdraw = require("./models/Withdraw");

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
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ error: "Mobile & password required" });
    }

    const mobileStr = String(mobile);

    const existing = await User.findOne({ mobile: mobileStr });
    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      mobile: mobileStr,
      password: hashedPassword,
      wallet: 0
    });

    return res.json({ message: "Registered successfully" });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ================= LOGIN ================= */

app.post("/login", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    const user = await User.findOne({ mobile: String(mobile) });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id },
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
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  if (elapsed >= 30) {
    return res.status(400).json({ error: "Round closed" });
  }

  const { color, amount } = req.body;
  const user = await User.findOne({ mobile: req.user.mobile });

  if (amount > user.wallet) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  user.wallet -= amount;
  user.totalWagered += amount;
  await user.save();

  await Bet.create({
    mobile: user.mobile,
    color,
    amount,
    roundId: CURRENT_ROUND.id,
    status: "PENDING"
  });

  res.json({ message: "Bet placed", roundId: CURRENT_ROUND.id });
});

/* =========================
   ROUND INFO
========================= */
app.get("/round/current", (req, res) => {
  res.json(CURRENT_ROUND);
});

app.get("/rounds/history", async (req, res) => {
  const rounds = await Round.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .select("roundId winner createdAt");

  res.json(rounds);
});

/* =========================
   ROUND RESOLUTION
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
      await User.updateOne(
        { mobile: bet.mobile },
        { $inc: { wallet: bet.amount * 2 * 0.98 } }
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
  const { amount } = req.body;
  const user = await User.findOne({ mobile: req.user.mobile });

  if (amount < 100) return res.status(400).json({ error: "Minimum ₹100" });
  if (!user.deposited) return res.status(400).json({ error: "Deposit required" });
  if (amount > user.wallet) return res.status(400).json({ error: "No balance" });

  const required = Math.max(user.bonus, user.depositAmount);
  if (user.totalWagered < required) {
    return res.status(400).json({
      error: `Wager ₹${required - user.totalWagered} more`
    });
  }

  await Withdraw.create({
    mobile: user.mobile,
    amount,
    method: user.withdrawMethod,
    details: user.withdrawDetails
  });

  user.wallet -= amount;
  await user.save();

  res.json({ message: "Withdraw request submitted" });
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
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 BIGWIN backend running on", PORT);
});
