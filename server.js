require("dotenv").config();
const http = require("http");
const connectDB = require("./db");
const app = require("./app");
const { endRoundAndPayout, ensureActiveRound } = require("./services/roundService");

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();

  const server = http.createServer(app);

  const { Server } = require("socket.io");
  const io = new Server(server, {
    cors: { origin: "https://color-game-frontend.pages.dev", methods: ["GET", "POST"] },
  });

  io.on("connection", async (socket) => {
    // Send current round to new client
    const round = await ensureActiveRound();
    socket.emit("round:started", { round });
  });

  // Round end check interval
  setInterval(async () => {
    try {
      await endRoundAndPayout(io);
    } catch (e) {
      console.error("Round processing error:", e.message);
    }
  }, 1000);

  server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});
