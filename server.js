const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let USERS = {
  demo: {
    balance: 100
  }
};

/* Health check */
app.get("/", (req, res) => {
  res.send("BIGWIN Backend Running");
});

/* Get wallet */
app.get("/wallet", (req, res) => {
  res.json({
    balance: USERS.demo.balance
  });
});

/* Place bet */
app.post("/bet", (req, res) => {
  const { amount, color } = req.body;

  if (!amount || amount < 1) {
    return res.status(400).json({ error: "Minimum bet is 1" });
  }

  if (amount > USERS.demo.balance) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  // 🔐 SAFE RANDOM RESULT
  const win = Math.random() > 0.5;

  if (win) {
    USERS.demo.balance += amount;
  } else {
    USERS.demo.balance -= amount;
  }

  res.json({
    result: win ? "WIN" : "LOSE",
    balance: USERS.demo.balance
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BIGWIN backend running on ${PORT}`);
});
