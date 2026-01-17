const mongoose = require("mongoose");

const HouseStatsSchema = new mongoose.Schema(
  {
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "Round", default: null },
    totalBet: { type: Number, default: 0 },
    totalPayout: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HouseStats", HouseStatsSchema);
