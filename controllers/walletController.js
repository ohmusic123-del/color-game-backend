const mongoose = require("mongoose");
const User = require("../models/User");
const Deposit = require("../models/Deposit");
const Withdraw = require("../models/Withdraw");
const AdminSettings = require("../models/AdminSettings");
const { requireFields, isPositiveNumber } = require("../validators/common");

exports.depositRequest = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["amount", "referenceId"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const amount = Number(req.body.amount);
    const referenceId = String(req.body.referenceId).trim();

    if (!isPositiveNumber(amount)) return res.status(400).json({ error: "Invalid amount" });
    if (referenceId.length < 6) return res.status(400).json({ error: "Invalid referenceId" });

    const exists = await Deposit.findOne({ referenceId });
    if (exists) return res.status(400).json({ error: "ReferenceId already used" });

    const deposit = await Deposit.create({
      userId: req.user.userId,
      amount,
      referenceId,
      status: "PENDING",
    });

    res.json({ message: "Deposit request submitted, waiting for admin approval", deposit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.withdrawRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const missing = requireFields(req.body, ["amount", "method", "upiId"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const amount = Number(req.body.amount);
    const method = String(req.body.method);
    const upiId = String(req.body.upiId).trim();

    if (!isPositiveNumber(amount)) return res.status(400).json({ error: "Invalid amount" });

    const settings = (await AdminSettings.findOne().session(session)) || {};
    const minWithdraw = Number(process.env.MIN_WITHDRAW || settings.minWithdraw || 100);
    const maxWithdraw = Number(process.env.MAX_WITHDRAW || settings.maxWithdraw || 50000);
    const dailyLimit = Number(process.env.DAILY_WITHDRAW_LIMIT || settings.dailyWithdrawLimit || 100000);

    if (amount < minWithdraw) return res.status(400).json({ error: `Minimum withdraw is ${minWithdraw}` });
    if (amount > maxWithdraw) return res.status(400).json({ error: `Maximum withdraw is ${maxWithdraw}` });

    // Daily limit check (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24h = await Withdraw.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.user.userId), createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const total24h = (last24h[0] && last24h[0].total) || 0;
    if (total24h + amount > dailyLimit) {
      return res.status(400).json({ error: `Daily withdraw limit exceeded (${dailyLimit})` });
    }

    const user = await User.findById(req.user.userId).session(session);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.wallet < amount) return res.status(400).json({ error: "Insufficient wallet balance" });

    user.wallet -= amount;
    user.withdrawalHeld = (user.withdrawalHeld || 0) + amount;
    await user.save({ session });

    const withdraw = await Withdraw.create(
      [
        { userId: user._id, amount, method, upiId, status: "PENDING" },
      ],
      { session }
    );

    await session.commitTransaction();
    res.json({ message: "Withdraw request submitted, waiting for admin approval", withdraw: withdraw[0] });
  } catch (e) {
    await session.abortTransaction();
    res.status(500).json({ error: e.message });
  } finally {
    session.endSession();
  }
};

exports.history = async (req, res) => {
  try {
    const deposits = await Deposit.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    const withdraws = await Withdraw.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.json({ deposits, withdraws });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
