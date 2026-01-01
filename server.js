require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connect
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error(err));

// Demo wallet (temporary)
let wallet = 1000;

// Home
app.get("/", (req, res) => {
  res.send("Color Game Backend Running");
});

// Get wallet
app.get("/wallet", (req, res) => {
  res.json({ balance: wallet });
});

// Place bet
app.post("/bet", (req, res) => {
  const { color, amount } = req.body;

  if (wallet < amount) {
    return res.status(400).json({ message: "Insufficient balance" });
  }

  wallet -= amount;

  const colors = ["RED", "GREEN", "VIOLET"];
  const result = colors[Math.floor(Math.random() * colors.length)];

  let win = false;
  let winAmount = 0;

  if (color === result) {
    win = true;
    winAmount = amount * (color === "VIOLET" ? 4.5 : 2);
    wallet += winAmount;
  }

  res.json({
    result,
    win,
    wallet
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);
