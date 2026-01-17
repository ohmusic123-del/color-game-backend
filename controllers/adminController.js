const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Deposit = require("../models/Deposit");
const Withdraw = require("../models/Withdraw");
const AdminAuditLog = require("../models/AdminAuditLog");
const { requireFields, isPositiveNumber } = require("../validators/common");
const { logAdminAction } = require("../services/auditService");

exports.adminLogin = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["username", "password"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const { username, password } = req.body;

    // admin credentials via env
    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPassHash = process.env.ADMIN_PASS_HASH; // recommended
    const adminPassPlain = process.env.ADMIN_PASS; // fallback (not recommended)

    let ok = false;
    if (adminPassHash) {
      ok = username === adminUser && (await bcrypt.compare(password, adminPassHash));
    } else if (adminPassPlain) {
      ok = username === adminUser && password === adminPassPlain;
    } else {
      return res.status(500).json({ error: "Admin credentials not configured" });
    }

    if (!ok) return res.status(401).json({ error: "Invalid admin credentials" });

    const token = jwt.sign(
      { role: "admin", username },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    await logAdminAction({ adminUsername: username, action: "ADMIN_LOGIN" });

    res.json({ message: "Admin login success", token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getPendingDeposits = async (req, res) => {
  const list = await Deposit.find({ status: "PENDING" }).sort({ createdAt: -1 });
  res.json({ deposits: list });
};

exports.approveDeposit = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["depositId"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const deposit = await Deposit.findById(req.body.depositId);
    if (!deposit) return res.status(404).json({ error: "Deposit not found" });
    if (deposit.status !== "PENDING") return res.status(400).json({ error: "Deposit already processed" });

    const user = await User.findById(deposit.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.wallet += deposit.amount;
    await user.save();

    deposit.status = "SUCCESS";
    deposit.approvedAt = new Date();
    await deposit.save();

    await logAdminAction({ adminUsername: req.admin.username, action: "DEPOSIT_APPROVED", meta: { depositId: deposit._id, userId: user._id, amount: deposit.amount } });

    res.json({ message: "Deposit approved", wallet: user.wallet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.rejectDeposit = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["depositId", "reason"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const deposit = await Deposit.findById(req.body.depositId);
    if (!deposit) return res.status(404).json({ error: "Deposit not found" });
    if (deposit.status !== "PENDING") return res.status(400).json({ error: "Deposit already processed" });

    deposit.status = "FAILED";
    deposit.rejectedAt = new Date();
    deposit.reason = String(req.body.reason).slice(0, 200);
    await deposit.save();

    await logAdminAction({ adminUsername: req.admin.username, action: "DEPOSIT_REJECTED", meta: { depositId: deposit._id, reason: deposit.reason } });

    res.json({ message: "Deposit rejected" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getPendingWithdraws = async (req, res) => {
  const list = await Withdraw.find({ status: "PENDING" }).sort({ createdAt: -1 });
  res.json({ withdraws: list });
};

exports.approveWithdraw = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["withdrawId"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const w = await Withdraw.findById(req.body.withdrawId);
    if (!w) return res.status(404).json({ error: "Withdraw not found" });
    if (w.status !== "PENDING") return res.status(400).json({ error: "Already processed" });

    const user = await User.findById(w.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // release held
    user.withdrawalHeld = Math.max(0, (user.withdrawalHeld || 0) - w.amount);
    await user.save();

    w.status = "SUCCESS";
    w.approvedAt = new Date();
    await w.save();

    await logAdminAction({ adminUsername: req.admin.username, action: "WITHDRAW_APPROVED", meta: { withdrawId: w._id, amount: w.amount, userId: user._id } });

    res.json({ message: "Withdraw approved" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.rejectWithdraw = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["withdrawId", "reason"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const w = await Withdraw.findById(req.body.withdrawId);
    if (!w) return res.status(404).json({ error: "Withdraw not found" });
    if (w.status !== "PENDING") return res.status(400).json({ error: "Already processed" });

    const user = await User.findById(w.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // refund from held back to wallet
    user.withdrawalHeld = Math.max(0, (user.withdrawalHeld || 0) - w.amount);
    user.wallet += w.amount;
    await user.save();

    w.status = "FAILED";
    w.rejectedAt = new Date();
    w.reason = String(req.body.reason).slice(0, 200);
    await w.save();

    await logAdminAction({ adminUsername: req.admin.username, action: "WITHDRAW_REJECTED", meta: { withdrawId: w._id, amount: w.amount, reason: w.reason } });

    res.json({ message: "Withdraw rejected & refunded" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.auditLogs = async (req, res) => {
  const logs = await AdminAuditLog.find().sort({ createdAt: -1 }).limit(200);
  res.json({ logs });
};



const AdminSettings = require("../models/AdminSettings");

exports.getSettings = async (req, res) => {
  let settings = await AdminSettings.findOne();
  if (!settings) settings = await AdminSettings.create({});
  res.json({ settings });
};

exports.setForcedWinner = async (req, res) => {
  const { winner } = req.body;
  if (!["RED", "GREEN", "VIOLET", null, ""].includes(winner)) {
    return res.status(400).json({ error: "Invalid winner" });
  }
  let settings = await AdminSettings.findOne();
  if (!settings) settings = await AdminSettings.create({});
  settings.forcedWinner = winner || null;
  await settings.save();
  res.json({ message: "Forced winner updated", forcedWinner: settings.forcedWinner });
};

exports.searchUsers = async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 1) return res.json({ users: [] });

  const users = await User.find({
    username: { $regex: q, $options: "i" },
  })
    .select("_id username wallet bonus withdrawalHeld createdAt")
    .limit(20);

  res.json({ users });
};

exports.updateUserWallet = async (req, res) => {
  const { userId, walletDelta, bonusDelta } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const w = Number(walletDelta || 0);
  const b = Number(bonusDelta || 0);

  if (!Number.isFinite(w) || !Number.isFinite(b)) {
    return res.status(400).json({ error: "Invalid delta values" });
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { wallet: w, bonus: b } },
    { new: true }
  ).select("_id username wallet bonus withdrawalHeld");

  if (!user) return res.status(404).json({ error: "User not found" });

  await logAdminAction({
    adminUsername: req.admin.username,
    action: "USER_BALANCE_UPDATED",
    meta: { userId, walletDelta: w, bonusDelta: b },
  });

  res.json({ message: "Updated", user });
};

exports.transactionsReport = async (req, res) => {
  const Deposit = require("../models/Deposit");
  const Withdraw = require("../models/Withdraw");
  const Bet = require("../models/Bet");

  const deposits = await Deposit.find().sort({ createdAt: -1 }).limit(200);
  const withdraws = await Withdraw.find().sort({ createdAt: -1 }).limit(200);
  const bets = await Bet.find().sort({ createdAt: -1 }).limit(200);

  res.json({ deposits, withdraws, bets });
};


exports.getUserDetails = async (req, res) => {
  const { userId } = req.params;
  const Bet = require("../models/Bet");
  const Deposit = require("../models/Deposit");
  const Withdraw = require("../models/Withdraw");
  const BonusLog = require("../models/BonusLog");

  const user = await User.findById(userId).select("_id username wallet bonus withdrawalHeld isBlocked betLimit createdAt");
  if (!user) return res.status(404).json({ error: "User not found" });

  const deposits = await Deposit.find({ userId }).sort({ createdAt: -1 }).limit(50);
  const withdraws = await Withdraw.find({ userId }).sort({ createdAt: -1 }).limit(50);
  const bets = await Bet.find({ userId }).sort({ createdAt: -1 }).limit(50);
  const bonusLogs = await BonusLog.find({ userId }).sort({ createdAt: -1 }).limit(50);

  res.json({ user, deposits, withdraws, bets, bonusLogs });
};

exports.setUserBlock = async (req, res) => {
  const { userId, isBlocked } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const user = await User.findByIdAndUpdate(
    userId,
    { isBlocked: !!isBlocked },
    { new: true }
  ).select("_id username isBlocked");

  if (!user) return res.status(404).json({ error: "User not found" });

  await logAdminAction({
    adminUsername: req.admin.username,
    action: "USER_BLOCK_STATUS_UPDATED",
    meta: { userId, isBlocked: !!isBlocked },
  });

  res.json({ message: "Updated", user });
};

exports.setUserBetLimit = async (req, res) => {
  const { userId, betLimit } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const limit = Number(betLimit);
  if (!Number.isFinite(limit) || limit <= 0) {
    return res.status(400).json({ error: "Invalid betLimit" });
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { betLimit: limit },
    { new: true }
  ).select("_id username betLimit");

  if (!user) return res.status(404).json({ error: "User not found" });

  await logAdminAction({
    adminUsername: req.admin.username,
    action: "USER_BET_LIMIT_UPDATED",
    meta: { userId, betLimit: limit },
  });

  res.json({ message: "Updated", user });
};


exports.houseStats = async (req, res) => {
  const HouseStats = require("../models/HouseStats");
  const rows = await HouseStats.find().sort({ createdAt: -1 }).limit(200);

  const summary = rows.reduce(
    (acc, r) => {
      acc.totalBet += r.totalBet;
      acc.totalPayout += r.totalPayout;
      acc.profit += r.profit;
      return acc;
    },
    { totalBet: 0, totalPayout: 0, profit: 0 }
  );

  res.json({ summary, rows });
};

exports.updateProbabilities = async (req, res) => {
  const { probRed, probGreen, probViolet } = req.body;

  let settings = await AdminSettings.findOne();
  if (!settings) settings = await AdminSettings.create({});

  const pr = Number(probRed);
  const pg = Number(probGreen);
  const pv = Number(probViolet);

  if (![pr, pg, pv].every((x) => Number.isFinite(x) && x >= 0)) {
    return res.status(400).json({ error: "Invalid probabilities" });
  }
  if (pr + pg + pv <= 0) {
    return res.status(400).json({ error: "Sum must be > 0" });
  }

  settings.probRed = pr;
  settings.probGreen = pg;
  settings.probViolet = pv;
  await settings.save();

  await logAdminAction({
    adminUsername: req.admin.username,
    action: "PROBABILITIES_UPDATED",
    meta: { probRed: pr, probGreen: pg, probViolet: pv },
  });

  res.json({ message: "Probabilities updated", settings });
};
