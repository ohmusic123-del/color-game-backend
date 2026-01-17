const router = require("express").Router();
const auth = require("../middleware/auth");
const { me, bonusLogs } = require("../controllers/userController");

router.get("/me", auth, me);
router.get("/bonus-logs", auth, bonusLogs);

module.exports = router;
