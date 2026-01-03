const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = "BIGWIN_SECRET_KEY";

/* ================= STORAGE ================= */
const users = {};
let round = {
  red: 0,
  green: 0,
  bets: []
};

/* ================= AUTH ================= */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });
  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.send("BIGWIN Backend Running");
});

/* REGISTER */
app.post("/api/register", (req, res) => {
  const { mobile, password } = req.body;
  if (users[mobile]) {
    return res.status(400).json({ error: "User exists" });
  }

  users[mobile] = {
    mobile,
    password,
    wallet: 100,
    wagered: 0
  };

  res.json({ message: "Registered successfully" });
});

/* LOGIN */
app.post("/api/login", (req, res) => {
  const { mobile, password } = req.body;
  const user = users[mobile];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid login" });
  }

  const token = jwt.sign({ mobile }, JWT_SECRET);
  res.json({ token, wallet: user.wallet });
});

/* CURRENT ROUND */
app.get("/api/game/round", auth, (req, res) => {
  res.json({ status: "OPEN" });
});

/* PLACE BET */
app.post("/api/game/bet", auth, (req, res) => {
  const { color, amount } = req.body;
  const user = users[req.user.mobile];

  if (!["RED", "GREEN"].includes(color))
    return res.status(400).json({ error: "Invalid color" });

  if (amount < 1)
    return res.status(400).json({ error: "Minimum bet is 1" });

  if (user.wallet < amount)
    return res.status(400).json({ error: "Insufficient balance" });

  user.wallet -= amount;
  user.wagered += amount;

  if (color === "RED") round.red += amount;
  else round.green += amount;

  round.bets.push({ mobile: user.mobile, color, amount });

  res.json({ message: "Bet placed", wallet: user.wallet });
});

/* CLOSE ROUND EVERY 30 SECONDS */
setInterval(() => {
  if (round.bets.length === 0) return;

  const winner = round.red <= round.green ? "RED" : "GREEN";

  round.bets.forEach(b => {
    if (b.color === winner) {
      const win = b.amount * 2;
      const payout = win - win * 0.02;
      users[b.mobile].wallet += payout;
    }
  });

  round = { red: 0, green: 0, bets: [] };
}, 30000);

app.listen(PORT, () => {
  console.log("BIGWIN backend running on port", PORT);
});
