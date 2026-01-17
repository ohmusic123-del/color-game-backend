const router = require("express").Router();
const auth = require("../middleware/auth");
const { depositRequest, withdrawRequest, history } = require("../controllers/walletController");

router.post("/deposit", auth, depositRequest);
router.post("/withdraw", auth, withdrawRequest);
router.get("/history", auth, history);

module.exports = router;
