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

/* ======================
   BASIC TEST ROUTE
====================== */
app.get("/", (req, res) => {
  res.send("Color Game Backend Running");
});

/* ======================
   REGISTER (NO OTP)
====================== */
app.post("/register", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ message: "Mobile & password required" });
    }

    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      mobile,
      password: hashedPassword
    });

    await Wallet.create({ userId: user._id });

    res.json({ message: "Registration successful" });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ======================
   LOGIN (MOBILE + PASSWORD)
====================== */
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
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ======================
   WALLET
====================== */
app.get("/wallet/:userId", async (req, res) => {
  const wallet = await Wallet.findOne({ userId: req.params.userId });
  res.json({ balance: wallet.balance });
});

/* ======================
   DATABASE + SERVER
====================== */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected");
    app.listen(process.env.PORT || 5000, () =>
      console.log("Server running")
    );
  })
  .catch(err => console.log("Mongo error:", err));
