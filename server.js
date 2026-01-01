require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Wallet = require("./models/Wallet");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ ROUTES FIRST (IMPORTANT)
// ✅ REAL WALLET (MongoDB)
app.get("/wallet", async (req, res) => {
  let wallet = await Wallet.findOne();
  if (!wallet) wallet = await Wallet.create({});
  res.json({ balance: wallet.balance });
});

app.post("/bet", async (req, res) => {
  const { color, amount } = req.body;

  let wallet = await Wallet.findOne();
  if (!wallet) wallet = await Wallet.create({});

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

// ✅ CONNECT TO MONGO IN BACKGROUND
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  })
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("Mongo ERROR:", err.message));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);
