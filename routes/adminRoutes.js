const router = require("express").Router();
const adminAuth = require("../middleware/admin");
const {
  adminLogin,
  getPendingDeposits,
  approveDeposit,
  rejectDeposit,
  getPendingWithdraws,
  approveWithdraw,
  rejectWithdraw,
  auditLogs,
  getSettings,
  setForcedWinner,
  searchUsers,
  updateUserWallet,
  transactionsReport,
  getUserDetails,
  setUserBlock,
  setUserBetLimit,
  houseStats,
  updateProbabilities,
} = require("../controllers/adminController");

router.post("/login", adminLogin);

router.get("/deposits/pending", adminAuth, getPendingDeposits);
router.post("/deposits/approve", adminAuth, approveDeposit);
router.post("/deposits/reject", adminAuth, rejectDeposit);

router.get("/withdraws/pending", adminAuth, getPendingWithdraws);
router.post("/withdraws/approve", adminAuth, approveWithdraw);
router.post("/withdraws/reject", adminAuth, rejectWithdraw);

router.get("/audit/logs", adminAuth, auditLogs);

router.get("/settings", adminAuth, getSettings);
router.post("/settings/forced-winner", adminAuth, setForcedWinner);

router.get("/users/search", adminAuth, searchUsers);
router.post("/users/update-wallet", adminAuth, updateUserWallet);
router.get("/reports/transactions", adminAuth, transactionsReport);

router.get("/users/:userId/details", adminAuth, getUserDetails);
router.post("/users/block", adminAuth, setUserBlock);
router.post("/users/bet-limit", adminAuth, setUserBetLimit);

router.get("/stats/house", adminAuth, houseStats);
router.post("/settings/probabilities", adminAuth, updateProbabilities);

module.exports = router;
