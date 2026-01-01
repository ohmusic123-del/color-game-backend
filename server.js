require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("./models/User");
const Wallet = require("./models/Wallet");

const app = express();
app.use(cors());
app.use(express.json());

/* ===============================
   HEALTH CHECK (OPTIONAL)
================================ */
app.get("/", (req, res) => {
  res.send("Color Game Backend Running");
});

/* ===============================
   REGISTER (MOBILE + PASSWORD)
================================ */
app.post("/register", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ message: "Mobile and password required" });
    }

    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      mobile,
      password: hashedPassword
    });

    await Wallet.create({ userId: user._id });

    res.json({ message: "Registration successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   LOGIN (MOBILE + PASSWORD)
================================ */
app.post("/login", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===============================
   AUTH MIDDLEWARE
================================ */
const auth = (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

/* ===============================
   WALLET
================================ */
app.get("/wallet", auth, async (req, res) => {
  const wallet = await Wallet.findOne({ userId: req.userId });
  res.json({ balance: wallet.balance });
});

/* ===============================
   BET
================================ */
app.post("/bet", auth, async (req, res) => {
  const { color, amount } = req.body;

  const wallet = await Wallet.findOne({ userId: req.userId });

  if (wallet.balance < amount) {
    return res.status(400).json({ message: "Insufficient balance" });
  }

  wallet.balance -= amount;

  const colors = ["RED", "GREEN", "VIOLET"];
  const result = colors[Math.floor(Math.random() * colors.length)];

  if (color === result) {
    wallet.balance += amount * (color === "VIOLET" ? 4.5 : 2);
  }

  await wallet.save();

  res.json({
    result,
    wallet: wallet.balance
  });
});

/* ===============================
   MONGODB CONNECTION
================================ */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("Mongo Error:", err));

/* ===============================
   START SERVER
================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
