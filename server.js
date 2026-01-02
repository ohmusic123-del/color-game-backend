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

/* HEALTH */
app.get("/", (req, res) => {
  res.send("Color Game Backend Running");
});

/* REGISTER */
app.post("/register", async (req, res) => {
  const { mobile, password } = req.body;
  if (!mobile || !password)
    return res.status(400).json({ message: "All fields required" });

  const exists = await User.findOne({ mobile });
  if (exists) return res.status(400).json({ message: "User exists" });

  const hashed = await bcrypt.hash(password, 10);
  await User.create({ mobile, password: hashed });

  res.json({ message: "Registration successful" });
});

/* LOGIN */
app.post("/login", async (req, res) => {
  const { mobile, password } = req.body;

  const user = await User.findOne({ mobile });
  if (!user) return res.status(400).json({ message: "User not found" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: "Wrong password" });

  const token = jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, wallet: user.wallet });
});

/* PLACE BET */
app.post("/bet", auth, async (req, res) => {
  const { color, amount } = req.body;
  const user = await User.findById(req.userId);

  if (user.wallet < amount)
    return res.status(400).json({ message: "Low balance" });

  user.wallet -= amount;
  await user.save();

  await Bet.create({ userId: user._id, color, amount });

  res.json({ message: "Bet placed", wallet: user.wallet });
});

/* GAME LOGIC */
let currentResult = "RED";
setInterval(async () => {
  const colors = ["RED", "GREEN", "VIOLET"];
  currentResult = colors[Math.floor(Math.random() * colors.length)];

  const bets = await Bet.find({ result: { $exists: false } });
  for (const bet of bets) {
    const user = await User.findById(bet.userId);
    if (!user) continue;

    if (bet.color === currentResult) {
      const win = bet.amount * 2;
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
}, 30000);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

app.listen(process.env.PORT, () =>
  console.log("Server running on", process.env.PORT)
);
