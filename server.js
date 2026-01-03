require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const User = require("./models/User");
const Bet = require("./models/Bet");
const auth = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json());

let roundId = 1;
let pool = { RED: 0, GREEN: 0, VIOLET: 0 };

app.get("/", (_, res) => res.send("BIGWIN Backend Running"));

/* REGISTER */
app.post("/register", async (req, res) => {
  const { mobile, password } = req.body;
  const exists = await User.findOne({ mobile });
  if (exists) return res.status(400).json({ message: "User exists" });

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    mobile,
    password: hash,
    wallet: 100 // signup bonus
  });

  res.json({ message: "Registered" });
});

/* LOGIN */
app.post("/login", async (req, res) => {
  const { mobile, password } = req.body;
  const user = await User.findOne({ mobile });
  if (!user) return res.status(400).json({ message: "Invalid login" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ message: "Invalid login" });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  res.json({ token, wallet: user.wallet });
});

/* PLACE BET */
app.post("/bet", auth, async (req, res) => {
  const { color, amount } = req.body;
  if (amount < 1) return res.json({ message: "Min bet is 1" });

  const user = await User.findById(req.userId);
  if (user.wallet < amount) return res.json({ message: "Low balance" });

  user.wallet -= amount;
  user.totalWagered += amount;
  await user.save();

  pool[color] += amount;

  await Bet.create({
    userId: user._id,
    color,
    amount,
    roundId
  });

  res.json({ message: "Bet placed", wallet: user.wallet });
});

/* ROUND SETTLEMENT */
setInterval(async () => {
  const entries = Object.entries(pool);
  if (entries.every(e => e[1] === 0)) return;

  const winner = entries.sort((a, b) => a[1] - b[1])[0][0];

  const bets = await Bet.find({ roundId });
  let totalPool = entries.reduce((a, b) => a + b[1], 0);

  for (const bet of bets) {
    if (bet.color === winner) {
      let win = bet.amount * 2;
      let fee = win * 0.02;
      let payout = win - fee;

      const user = await User.findById(bet.userId);
      user.wallet += payout;
      await user.save();

      bet.result = "WIN";
      bet.payout = payout;
    } else {
      bet.result = "LOSS";
      bet.payout = 0;
    }
    await bet.save();
  }

  pool = { RED: 0, GREEN: 0, VIOLET: 0 };
  roundId++;
}, 30000);

/* WALLET */
app.get("/wallet", auth, async (req, res) => {
  const user = await User.findById(req.userId);
  res.json({ wallet: user.wallet });
});

mongoose.connect(process.env.MONGO_URI).then(() => {
  app.listen(process.env.PORT, () =>
    console.log("Server running")
  );
});
