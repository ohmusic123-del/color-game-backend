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
app.use(express.json());

app.get("/", (req, res) => res.send("BIGWIN backend running"));

app.post("/register", async (req, res) => {
  try {
    await User.create(req.body);
    res.json({ message: "Registered" });
  } catch {
    res.status(400).json({ error: "User exists" });
  }
});

app.post("/login", async (req, res) => {
  const user = await User.findOne(req.body);
  if (!user) return res.status(401).json({ error: "Invalid" });

  const token = jwt.sign({ mobile: user.mobile }, process.env.JWT_SECRET);
  res.json({ token, wallet: user.wallet });
});

app.get("/wallet", auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.user.mobile });
  res.json({ wallet: u.wallet });
});

app.post("/bet", auth, async (req, res) => {
  const { color, amount, roundId } = req.body;
  const u = await User.findOne({ mobile: req.user.mobile });

  if (amount > u.wallet) return res.status(400).json({ error: "No balance" });

  u.wallet -= amount;
  u.wagered += amount;
  await u.save();

  await Bet.create({ mobile: u.mobile, color, amount, roundId });
  res.json({ message: "Bet placed" });
});

app.post("/round/resolve", async (req, res) => {
  const bets = await Bet.find({ roundId: req.body.roundId });
  let red = 0, green = 0;

  bets.forEach(b => b.color === "red" ? red += b.amount : green += b.amount);
  const winner = red < green ? "red" : green < red ? "green" : Math.random() < .5 ? "red" : "green";

  for (const b of bets) {
    if (b.color === winner) {
      const payout = b.amount * 2 * 0.98;
      const u = await User.findOne({ mobile: b.mobile });
      u.wallet += payout;
      await u.save();
    }
  }

  await Round.create({ roundId: req.body.roundId, redPool: red, greenPool: green, winner });
  res.json({ winner });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
