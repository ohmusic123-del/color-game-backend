const Bet = require("../models/Bet");
const Round = require("../models/Round");
const User = require("../models/User");
const mongoose = require("mongoose");
const { requireFields, isPositiveNumber } = require("../validators/common");
const { ensureActiveRound } = require("../services/roundService");

exports.getRound = async (req, res) => {
  try {
    const round = await ensureActiveRound();
    res.json({ round });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.lastResult = async (req, res) => {
  try {
    const last = await Round.findOne({ status: "ENDED" }).sort({ endTime: -1 });
    res.json({ last });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.placeBet = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const missing = requireFields(req.body, ["amount", "color"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const amount = Number(req.body.amount);
    const color = String(req.body.color);

    if (!isPositiveNumber(amount)) return res.status(400).json({ error: "Invalid amount" });
    if (!["RED", "GREEN", "VIOLET"].includes(color)) return res.status(400).json({ error: "Invalid color" });

    const round = await Round.findOne({ status: "ACTIVE" }).sort({ startTime: -1 }).session(session);
    if (!round) return res.status(400).json({ error: "No active round" });

    if (new Date() > new Date(round.endTime)) {
      return res.status(400).json({ error: "Round ended, wait for next round" });
    }

    const user = await User.findById(req.user.userId).session(session);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.isBlocked) return res.status(403).json({ error: "Account blocked by admin" });

    if (amount > (user.betLimit || 10000)) {
      return res.status(400).json({ error: `Bet limit exceeded. Max ${user.betLimit || 10000}` });
    }

    if (user.wallet < amount) return res.status(400).json({ error: "Insufficient wallet" });

    user.wallet -= amount;
    await user.save({ session });

    const bet = await Bet.create(
      [{ userId: user._id, roundId: round._id, amount, color, status: "PLACED" }],
      { session }
    );

    await session.commitTransaction();
    res.json({ message: "Bet placed", bet: bet[0], wallet: user.wallet });
  } catch (e) {
    await session.abortTransaction();
    res.status(500).json({ error: e.message });
  } finally {
    session.endSession();
  }
};
