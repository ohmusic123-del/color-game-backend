const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { requireFields } = require("../validators/common");

exports.register = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["username", "password"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const { username, password } = req.body;

    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: "Username already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword });

    res.json({ message: "Registered successfully", userId: user._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.login = async (req, res) => {
  try {
    const missing = requireFields(req.body, ["username", "password"]);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({
      message: "Login successful",
      token,
      user: { id: user._id, username: user.username, wallet: user.wallet, bonus: user.bonus },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
