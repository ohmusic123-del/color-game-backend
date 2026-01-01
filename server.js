require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ ROUTES FIRST (IMPORTANT)
app.get("/", (req, res) => {
  res.send("Color Game Backend Running");
});

app.get("/wallet", (req, res) => {
  res.json({ balance: 1000 });
});

app.post("/bet", (req, res) => {
  res.json({
    result: "RED",
    win: false,
    wallet: 900
  });
});

// ✅ CONNECT TO MONGO IN BACKGROUND
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  })
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("Mongo ERROR:", err.message));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);
