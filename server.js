import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

/* ------------------ IN-MEMORY STORAGE ------------------ */
const users = {};
let currentRound = null;

/* ------------------ HELPERS ------------------ */
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function getOrCreateRound() {
  if (!currentRound || currentRound.closed) {
    currentRound = {
      id: Date.now(),
      redPool: 0,
      greenPool: 0,
      bets: [],
      closed: false
    };
  }
  return currentRound;
}

/* ------------------ AUTH ------------------ */
app.post("/api/register", (req, res) => {
  const { mobile, password } = req.body;
  if (users[mobile]) return res.status(400).json({ error: "User exists" });

  users[mobile] = {
    mobile,
    password,
    wallet: 100, // signup bonus
    bonus: 100,
    wagered: 0,
    deposited: false
  };

  res.json({ message: "Registered", wallet: 100 });
});

app.post("/api/login", (req, res) => {
  const { mobile, password } = req.body;
  const user = users[mobile];
  if (!user || user.password !== password)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ mobile }, JWT_SECRET);
  res.json({ token, wallet: user.wallet });
});

/* ------------------ GAME ------------------ */
app.get("/api/game/round", auth, (req, res) => {
  const round = getOrCreateRound();
  res.json({ roundId: round.id });
});

app.post("/api/game/bet", auth, (req, res) => {
  const { amount, color } = req.body;
  const user = users[req.user.mobile];

  if (amount < 1) return res.status(400).json({ error: "Min bet ₹1" });
  if (user.wallet < amount)
    return res.status(400).json({ error: "Insufficient balance" });
  if (!["RED", "GREEN"].includes(color))
    return res.status(400).json({ error: "Invalid color" });

  const round = getOrCreateRound();

  user.wallet -= amount;
  user.wagered += amount;

  if (color === "RED") round.redPool += amount;
  else round.greenPool += amount;

  round.bets.push({ mobile: user.mobile, amount, color });

  res.json({ message: "Bet placed", wallet: user.wallet });
});

app.post("/api/game/close", (req, res) => {
  if (!currentRound || currentRound.closed)
    return res.json({ message: "No active round" });

  const winColor =
    currentRound.redPool <= currentRound.greenPool ? "RED" : "GREEN";

  currentRound.bets.forEach(bet => {
    if (bet.color === winColor) {
      const win = bet.amount * 2;
      const fee = win * 0.02;
      users[bet.mobile].wallet += win - fee;
    }
  });

  currentRound.closed = true;
  res.json({ winner: winColor });
});

/* ------------------ HEALTH ------------------ */
app.get("/", (req, res) => {
  res.send("BIGWIN Backend Running");
});

app.listen(PORT, () =>
  console.log(`BIGWIN backend running on ${PORT}`)
);
