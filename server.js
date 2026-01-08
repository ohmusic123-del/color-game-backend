require("dotenv").config();
require("./db");
const AdminSettings = require("./models/AdminSettings");
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

/* =========================
   MIDDLEWARE
========================= */
const auth = require("./middleware/auth");

function adminAuth(req, res, next) {
  try {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: "Admin token missing" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "admin") {
      return res.status(403).json({ error: "Admin access denied" });
    }

    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid admin token" });
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
   AUTH (USER)
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
   ADMIN LOGIN
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
app.get("/deposit/info", async (req, res) => {
  const settings = await AdminSettings.findOne();
  res.json(settings || {});
});
/* =========================
   RESOLVE ROUND
========================= */
async function resolveRound() {
  const roundId = CURRENT_ROUND.id;
  const bets = await Bet.find({ roundId });

  let redPool = 0, greenPool = 0;

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

/* AUTO ROUND EVERY 30s */
setInterval(async () => {
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  if (elapsed >= 30) {
    console.log("⏱ Resolving round:", CURRENT_ROUND.id);
    await resolveRound();
  }
}, 1000);
const Deposit = require("./models/Deposit");

app.post("/deposit", auth, async (req, res) => {
  const { amount, utr } = req.body;

  if (amount < 100) {
    return res.status(400).json({ error: "Minimum deposit ₹100" });
  }

  await Deposit.create({
    mobile: req.user.mobile,
    amount,
    utr
  });

  res.json({ message: "Deposit request submitted" });
});
app.post("/admin/deposit/:id", adminAuth, async (req, res) => {
  const { status } = req.body;

  const d = await Deposit.findById(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });

  if (d.status !== "PENDING") {
    return res.status(400).json({ error: "Already processed" });
  }

  d.status = status;
  await d.save();

  if (status === "APPROVED") {
    await User.updateOne(
      { mobile: d.mobile },
      {
        $inc: {
          wallet: d.amount,
          depositAmount: d.amount
        },
        $set: { deposited: true }
      }
    );
  }

  res.json({ message: `Deposit ${status.toLowerCase()}` });
});
app.get("/deposits", auth, async (req, res) => {
  const deposits = await Deposit.find({
    mobile: req.user.mobile
  })
    .sort({ createdAt: -1 })
    .limit(10);

  res.json(deposits);
});
async function loadDeposits() {
  const res = await fetch(API + "/deposits", {
    headers: { Authorization: token }
  });

  const data = await res.json();
  const box = document.getElementById("depositHistory");
  box.innerHTML = "";

  data.forEach(d => {
    box.innerHTML += `
      <div class="row">
        ₹${d.amount} |
        ${d.status} |
        ${new Date(d.createdAt).toLocaleString()}
      </div>
    `;
  });
}

loadDeposits();
/* =========================
   WITHDRAW (USER)
========================= */
app.post("/withdraw", auth, async (req, res) => {
  const { amount } = req.body;
  const u = await User.findOne({ mobile: req.user.mobile });

  if (amount < 100) return res.status(400).json({ error: "Min ₹100" });
  if (!u.deposited) return res.status(400).json({ error: "Deposit required" });
  if (amount > u.wallet) return res.status(400).json({ error: "No balance" });

  const required = Math.max(u.bonus, u.depositAmount);
  if (u.totalWagered < required) {
    return res.status(400).json({
      error: `Wager ₹${required - u.totalWagered} more`
    });
  }

  await Withdraw.create({
    mobile: u.mobile,
    amount,
    method: u.withdrawMethod,
    details: u.withdrawDetails
  });

  u.wallet -= amount;
  await u.save();

  res.json({ message: "Withdraw request submitted" });
});

/* =========================
   ADMIN WITHDRAW
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
   ADMIN DASHBOARD STATS
========================= */
app.get("/admin/stats", adminAuth, async (req, res) => {
  const totalUsers = await User.countDocuments();

  const totalDepositsAgg = await User.aggregate([
    { $group: { _id: null, total: { $sum: "$depositAmount" } } }
  ]);

  const totalDeposits = totalDepositsAgg[0]?.total || 0;

  const totalWithdrawAgg = await Withdraw.aggregate([
    { $match: { status: "APPROVED" } },
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);

  const totalWithdrawals = totalWithdrawAgg[0]?.total || 0;

  const totalWalletAgg = await User.aggregate([
    { $group: { _id: null, total: { $sum: "$wallet" } } }
  ]);

  const totalWallet = totalWalletAgg[0]?.total || 0;

  const totalRounds = await Round.countDocuments();

  const profit = totalDeposits - totalWithdrawals;

  res.json({
    totalUsers,
    totalDeposits,
    totalWithdrawals,
    totalWallet,
    totalRounds,
    profit
  });
});
app.post("/admin/deposit-info", adminAuth, async (req, res) => {
  const { upiId, qrImage } = req.body;

  let settings = await AdminSettings.findOne();

  if (!settings) {
    settings = new AdminSettings({ upiId, qrImage });
  } else {
    settings.upiId = upiId;
    settings.qrImage = qrImage;
    settings.updatedAt = new Date();
  }

  await settings.save();
  res.json({ message: "Deposit info updated" });
});
/* =========================
   START
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
