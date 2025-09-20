const express = require("express");
const axios = require("axios");
const app = express();
const PORT = process.env.PORT || 3000;

// Test link (sirf ek hi rakho abhi)
const BOT_URL = "https://ak-bot-8qqx.onrender.com"; 

// Self health endpoint
app.get("/ping", (req, res) => {
  res.json({ status: "KeepAlive Running ✅", uptime: process.uptime() });
});

// Ping BOT every 5 minutes
setInterval(async () => {
  try {
    const res = await axios.get(BOT_URL, { timeout: 10000 });
    console.log("✅ Ping success:", BOT_URL, res.status);
  } catch (err) {
    console.error("❌ Ping failed:", BOT_URL, err.message);
  }
}, 5 * 60 * 1000); // 5 min

// First ping after 5s
setTimeout(() => {
  axios.get(BOT_URL).then(() => console.log("✅ First ping success")).catch(e => console.error("❌ First ping fail:", e.message));
}, 5000);

app.listen(PORT, () => {
  console.log(`🚀 KeepAlive server running at http://localhost:${PORT}`);
});
