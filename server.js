require("dotenv").config();
require("./db");

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const User = require("./models/User");
const Bet = require("./models/Bet");
const Round = require("./models/Round");

const auth = require("./middleware/auth");

const app = express();
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

/* ===== AUTH ===== */

app.post("/register", async (req, res) => {
  try {
    await User.create({
      mobile: req.body.mobile,
      password: req.body.password,
      wallet: 100,     // signup bonus
      bonus: 100,
      deposited: false,
      totalWagered: 0
    });

    res.json({ message: "Registered with ₹100 bonus" });
  } catch (err) {
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

/* ===== WALLET ===== */

app.get("/wallet", auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.user.mobile });
  res.json({ wallet: u.wallet });
});

/* ===== PROFILE ===== */

app.get("/profile", auth, async (req, res) => {
  const user = await User.findOne({ mobile: req.user.mobile });

  res.json({
    mobile: user.mobile,
    wallet: user.wallet,
    totalWagered: user.totalWagered
  });
});

/* ===== BET HISTORY ===== */

app.get("/bets", auth, async (req, res) => {
  const bets = await Bet.find({ mobile: req.user.mobile })
    .sort({ createdAt: -1 })
    .limit(10);

  res.json(bets);
});

/* ===== ROUND ===== */

app.get("/round/current", (req, res) => {
  res.json(CURRENT_ROUND);
});
/* ===== BET ===== */

app.post("/bet", auth, async (req, res) => {

  // ⏱ Block betting after round ends
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

/* ===== RESOLVE ROUND ===== */

app.post("/round/resolve", async (req, res) => {
  const roundId = CURRENT_ROUND.id;
  const bets = await Bet.find({ roundId });

  let red = 0, green = 0;

  bets.forEach(b => {
    if (b.color === "red") red += b.amount;
    if (b.color === "green") green += b.amount;
  });

  let winner;
  if (red === green) {
    winner = Math.random() < 0.5 ? "red" : "green";
  } else {
    winner = red < green ? "red" : "green";
  }

  for (const b of bets) {
    if (b.color === winner) {
      const payout = b.amount * 2 * 0.98;
      await User.updateOne(
        { mobile: b.mobile },
        { $inc: { wallet: payout } }
      );
    }
  }

  await Round.create({
    roundId,
    redPool: red,
    greenPool: green,
    winner
  });

  // 🔁 NEW ROUND
  CURRENT_ROUND = {
    id: Date.now().toString(),
    startTime: Date.now()
  };

  res.json({
    winner,
    nextRoundId: CURRENT_ROUND.id
  });
});

/* ===== START ===== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Server running on", PORT)
);
