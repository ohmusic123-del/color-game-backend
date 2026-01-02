require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("./models/User");
const Bet = require("./models/Bet");
const auth = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("Color Game Backend Running");
});

/* =========================
   REGISTER
========================= */
app.post("/register", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ message: "All fields required" });
    }

    const exists = await User.findOne({ mobile });
    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await User.create({
      mobile,
      password: hashed,
      wallet: 1000
    });

    res.json({ message: "Registration successful" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   LOGIN
========================= */
app.post("/login", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Wrong password" });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      wallet: user.wallet
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   USER INFO
========================= */
app.get("/me", auth, async (req, res) => {
  const user = await User.findById(req.userId);
  res.json({ wallet: user.wallet });
});

/* =========================
   GAME STATE
========================= */
let currentRound = {
  roundId: 1,
  status: "OPEN",
  result: null
};

/* =========================
   PLACE BET
========================= */
app.post("/bet", auth, async (req, res) => {
  try {
    const { color, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.wallet < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    user.wallet -= amount;
    await user.save();

    await Bet.create({
      userId: user._id,
      roundId: currentRound.roundId,
      color,
      amount
    });

    res.json({
      message: "Bet placed successfully",
      wallet: user.wallet
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   SETTLE BETS
========================= */
const settleBets = async () => {
  const bets = await Bet.find({ roundId: currentRound.roundId });

  for (const bet of bets) {
    const user = await User.findById(bet.userId);
    if (!user) continue;

    if (bet.color === currentRound.result) {
      const multiplier = bet.color === "VIOLET" ? 4.5 : 2;
      const win = bet.amount * multiplier;

      user.wallet += win;
      bet.result = "WIN";
      bet.payout = win;
    } else {
      bet.result = "LOSS";
      bet.payout = 0;
    }

    await user.save();
    await bet.save();
  }
};

/* =========================
   ROUND TIMER (30s)
========================= */
setInterval(async () => {
  if (currentRound.status === "OPEN") {
    const colors = ["RED", "GREEN", "VIOLET"];
    currentRound.result =
      colors[Math.floor(Math.random() * colors.length)];
    currentRound.status = "CLOSED";

    await settleBets();

    currentRound = {
      roundId: currentRound.roundId + 1,
      status: "OPEN",
      result: null
    };
  }
}, 30000);

/* =========================
   CURRENT ROUND API
========================= */
app.get("/current-round", (req, res) => {
  res.json({
    roundId: currentRound.roundId,
    status: currentRound.status
  });
});

/* =========================
   DB + SERVER
========================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("Mongo Error", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("Server running on port", PORT)
);
