const Round = require("../models/Round");
const Bet = require("../models/Bet");
const User = require("../models/User");
const AdminSettings = require("../models/AdminSettings");
const HouseStats = require("../models/HouseStats");
const Referral = require("../models/Referral");
const BonusLog = require("../models/BonusLog");


function pickByProb(settings) {
  const r = Math.random();
  const pr = Number(settings?.probRed ?? 0.45);
  const pg = Number(settings?.probGreen ?? 0.45);
  const pv = Number(settings?.probViolet ?? 0.10);

  const sum = pr + pg + pv;
  const red = pr / sum;
  const green = pg / sum;

  if (r < red) return "RED";
  if (r < red + green) return "GREEN";
  return "VIOLET";
}

function randomColor() {
  const colors = ["RED", "GREEN", "VIOLET"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function payoutMultiplier(color) {
  if (color === "VIOLET") return 4;
  return 2;
}

async function getWinnerColor() {
  const settings = await AdminSettings.findOne();
  if (settings?.forcedWinner && ["RED", "GREEN", "VIOLET"].includes(settings.forcedWinner)) {
    const winner = settings.forcedWinner;
    // clear after using once
    settings.forcedWinner = null;
    await settings.save();
    return winner;
  }
  return pickByProb(settings);
}

// Referral commissions (customize)
const COMMISSION_LEVELS = [
  0.02, // Level 1 => 2%
  0.01, // Level 2 => 1%
  0.005, // Level 3 => 0.5%
];

async function payReferralCommission(bettorId, betAmount) {
  try {
    const ref = await Referral.findOne({ userId: bettorId });
    if (!ref || !Array.isArray(ref.uplines)) return;

    for (let i = 0; i < COMMISSION_LEVELS.length; i++) {
      const uplineId = ref.uplines[i];
      if (!uplineId) continue;

      const commission = betAmount * COMMISSION_LEVELS[i];
      if (commission <= 0) continue;

      await User.updateOne({ _id: uplineId }, { $inc: { bonus: commission } });
      await BonusLog.create({ userId: uplineId, sourceUserId: bettorId, level: i + 1, amount: commission, type: "REFERRAL_COMMISSION" });
    }
  } catch (e) {
    console.error("Referral commission error:", e.message);
  }
}

async function ensureActiveRound() {
  let round = await Round.findOne({ status: "ACTIVE" }).sort({ startTime: -1 });
  if (!round) {
    const startTime = new Date();
    const duration = Number(process.env.ROUND_DURATION_MS || 60000);
    const endTime = new Date(startTime.getTime() + duration);

    round = await Round.create({ startTime, endTime, status: "ACTIVE" });
  }
  return round;
}

async function endRoundAndPayout(io) {
  const round = await Round.findOne({ status: "ACTIVE" }).sort({ startTime: -1 });
  if (!round) return null;

  const now = new Date();
  if (now < new Date(round.endTime)) return null;

  round.status = "PROCESSING";
  await round.save();

  const winner = await getWinnerColor();
  round.winningColor = winner;
  round.status = "ENDED";
  await round.save();

  const bets = await Bet.find({ roundId: round._id, status: "PLACED" });

  let totalBet = 0;
  let totalPayout = 0;

  for (const bet of bets) {
    // Referral commission on every bet placed (house rule)
    totalBet += bet.amount;
    await payReferralCommission(bet.userId, bet.amount);

    if (bet.color === winner) {
      const mult = payoutMultiplier(winner);
      const winAmount = bet.amount * mult;

      totalPayout += winAmount;
      await User.updateOne({ _id: bet.userId }, { $inc: { wallet: winAmount } });
      bet.status = "WON";
      bet.payout = winAmount;
    } else {
      bet.status = "LOST";
      bet.payout = 0;
    }
    await bet.save();
  }

  const profit = totalBet - totalPayout;
  await HouseStats.create({ roundId: round._id, totalBet, totalPayout, profit });

  if (io) io.emit("round:ended", { roundId: String(round._id), winningColor: winner, totalBet, totalPayout, profit });

  const startTime = new Date();
  const duration = Number(process.env.ROUND_DURATION_MS || 60000);
  const endTime = new Date(startTime.getTime() + duration);

  const next = await Round.create({ startTime, endTime, status: "ACTIVE" });
  if (io) io.emit("round:started", { round: next });

  return { ended: round, next };
}

module.exports = { ensureActiveRound, endRoundAndPayout };
