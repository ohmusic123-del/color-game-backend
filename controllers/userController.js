const User = require("../models/User");
const BonusLog = require("../models/BonusLog");

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};


exports.bonusLogs = async (req, res) => {
  try {
    const logs = await BonusLog.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
