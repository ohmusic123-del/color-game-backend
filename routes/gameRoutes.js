const router = require("express").Router();
const auth = require("../middleware/auth");
const { getRound, placeBet, lastResult } = require("../controllers/gameController");

router.get("/round", auth, getRound);
router.get("/last-result", auth, lastResult);
router.post("/bet", auth, placeBet);

module.exports = router;
