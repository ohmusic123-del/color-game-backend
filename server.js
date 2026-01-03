const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { auth, SECRET } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

/* In-memory DB (safe demo) */
let USERS = {};

/* Health */
app.get("/", (req, res) => {
  res.send("BIGWIN Backend Running");
});

/* REGISTER */
app.post("/register", (req, res) => {
  const { mobile, password } = req.body;

  if (!mobile || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (USERS[mobile]) {
    return res.status(400).json({ error: "User exists" });
  }

  USERS[mobile] = {
    password,
    wallet: 100 // signup bonus
  };

  res.json({ message: "Registered successfully" });
});

/* LOGIN */
app.post("/login", (req, res) => {
  const { mobile, password } = req.body;

  const user = USERS[mobile];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ mobile }, SECRET, { expiresIn: "24h" });

  res.json({
    token,
    wallet: user.wallet
  });
});

/* WALLET (protected) */
app.get("/wallet", auth, (req, res) => {
  const user = USERS[req.user.mobile];
  res.json({ wallet: user.wallet });
});

/* BET (protected) */
app.post("/bet", auth, (req, res) => {
  const { amount } = req.body;
  const user = USERS[req.user.mobile];

  if (amount < 1) {
    return res.status(400).json({ error: "Minimum bet is 1" });
  }

  if (amount > user.wallet) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  const win = Math.random() < 0.5;

  if (win) user.wallet += amount;
  else user.wallet -= amount;

  res.json({
    result: win ? "WIN" : "LOSE",
    wallet: user.wallet
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("BIGWIN backend running on", PORT)
);
