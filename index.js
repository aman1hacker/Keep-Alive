// index.js
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Links file path
const LINKS_FILE = path.join(__dirname, "links.json");

// Initialize links.json if not exists
function initLinksFile() {
    if (!fs.existsSync(LINKS_FILE)) {
        const initialData = {
            links: [],
            stats: {
                totalLinks: 0,
                activeLinks: 0,
                lastUpdate: new Date().toISOString(),
            },
        };
        fs.writeFileSync(LINKS_FILE, JSON.stringify(initialData, null, 2));
        console.log("📄 Created links.json file");
    }
}

// Read links data
function readLinksData() {
    try {
        const data = fs.readFileSync(LINKS_FILE, "utf8");
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading links data:", error);
        return {
            links: [],
            stats: {
                totalLinks: 0,
                activeLinks: 0,
                lastUpdate: new Date().toISOString(),
            },
        };
    }
}

// Write links data
function writeLinksData(data) {
    try {
        data.stats.lastUpdate = new Date().toISOString();
        fs.writeFileSync(LINKS_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error("Error writing links data:", error);
        return false;
    }
}

// Generate 6-character uppercase alphanumeric code
function generateCode() {
    // ensure 6 chars, uppercase, [A-Z0-9]
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

// Basic URL validation (require https)
function isValidUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" || u.protocol === "http:";
    } catch (e) {
        return false;
    }
}

// Format ISO date/time to IST readable string
function formatIST(iso) {
    try {
        return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    } catch {
        return iso;
    }
}

// Ping a single URL (returns object)
async function pingUrl(url) {
    const startTime = Date.now();
    try {
        // Attempt GET root — some apps respond on / or /ping; caller can pass /ping if needed
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                "User-Agent": "KeepAlive-Ping-System/1.0",
                Accept: "*/*"
            }
        });
        const responseTime = Date.now() - startTime;
        return {
            success: true,
            status: "online",
            responseTime,
            statusCode: response.status,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
            success: false,
            status: "offline",
            responseTime,
            error: error.message,
            statusCode: error.response?.status || 0,
            timestamp: new Date().toISOString()
        };
    }
}

// Update link status object in memory (does not persist)
async function updateLinkStatus(linkData) {
    const pingResult = await pingUrl(linkData.url);

    linkData.lastCheck = pingResult.timestamp;
    linkData.status = pingResult.status;
    linkData.responseTime = pingResult.responseTime;
    linkData.statusCode = pingResult.statusCode;

    if (pingResult.success) {
        linkData.lastSuccess = pingResult.timestamp;
        linkData.failCount = 0;
    } else {
        linkData.failCount = (linkData.failCount || 0) + 1;
        linkData.lastError = pingResult.error;
    }

    linkData.totalChecks = (linkData.totalChecks || 0) + 1;

    return linkData;
}

// Initialize file
initLinksFile();

// ====== API ENDPOINTS ======

// Health check
app.get("/ping", (req, res) => {
    const data = readLinksData();
    res.json({
        status: "KeepAlive System Running ✅",
        uptime_seconds: Math.floor(process.uptime()),
        totalLinks: data.stats.totalLinks,
        activeLinks: data.stats.activeLinks,
        version: "2.0.0"
    });
});

// Add new link
app.post("/add", async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ success: false, message: "URL is required" });

        if (!isValidUrl(url)) return res.status(400).json({ success: false, message: "Invalid URL format (must be http/https)" });

        const data = readLinksData();

        // Normalize url (trim)
        const normalized = url.trim();

        // Check duplicate
        const existing = data.links.find(l => l.url === normalized);
        if (existing) {
            return res.status(409).json({ success: false, message: "URL already exists", code: existing.code });
        }

        // Generate unique code
        let code;
        do {
            code = generateCode();
        } while (data.links.some(l => l.code === code));

        // test ping
        console.log(`🔄 Testing new URL: ${normalized}`);
        const pingResult = await pingUrl(normalized);

        const newLink = {
            code,
            url: normalized,
            addedAt: new Date().toISOString(),
            lastCheck: pingResult.timestamp,
            status: pingResult.status,
            responseTime: pingResult.responseTime,
            statusCode: pingResult.statusCode,
            failCount: pingResult.success ? 0 : 1,
            totalChecks: 1
        };

        if (pingResult.success) newLink.lastSuccess = pingResult.timestamp;
        else newLink.lastError = pingResult.error;

        data.links.push(newLink);
        data.stats.totalLinks = data.links.length;
        data.stats.activeLinks = data.links.filter(l => l.status === "online").length;

        if (!writeLinksData(data)) {
            return res.status(500).json({ success: false, message: "Failed to save link" });
        }

        console.log(`✅ Added new link: ${normalized} (code=${code})`);
        return res.json({ success: true, message: "Link added", code, status: pingResult.status, responseTime: pingResult.responseTime });
    } catch (err) {
        console.error("/add error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// Get link status by code (fresh ping + IST formatted output)
app.get("/status/:code", async (req, res) => {
    try {
        const { code } = req.params;
        const data = readLinksData();
        const linkIndex = data.links.findIndex(l => l.code === code.toUpperCase());
        if (linkIndex === -1) return res.status(404).json({ success: false, message: "Invalid code" });

        const link = data.links[linkIndex];

        console.log(`🔄 Checking status for code=${code} url=${link.url}`);
        const updated = await updateLinkStatus(link);

        // store back
        data.links[linkIndex] = updated;
        data.stats.activeLinks = data.links.filter(l => l.status === "online").length;
        writeLinksData(data);

        // uptime calculation in days/hours/minutes
        const addedTime = new Date(updated.addedAt);
        const now = new Date();
        const diff = now - addedTime;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        return res.json({
            success: true,
            data: {
                code: updated.code,
                url: updated.url,
                status: updated.status,
                responseTime: `${updated.responseTime}ms`,
                statusCode: updated.statusCode,
                lastCheck: formatIST(updated.lastCheck),
                lastSuccess: updated.lastSuccess ? formatIST(updated.lastSuccess) : "Never",
                addedAt: formatIST(updated.addedAt),
                uptime: `${days}d ${hours}h ${minutes}m`,
                failCount: updated.failCount || 0,
                totalChecks: updated.totalChecks || 1,
                successRate: `${Math.round((((updated.totalChecks || 1) - (updated.failCount || 0)) / (updated.totalChecks || 1)) * 100)}%`
            }
        });
    } catch (err) {
        console.error("/status error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// Get all links (Admin view)
app.get("/all", (req, res) => {
    try {
        const data = readLinksData();
        const summary = data.links.map(link => {
            const addedTime = new Date(link.addedAt);
            const now = new Date();
            const uptimeHours = Math.floor((now - addedTime) / (1000 * 60 * 60));
            return {
                code: link.code,
                url: link.url,
                status: link.status,
                responseTime: `${link.responseTime}ms`,
                lastCheck: formatIST(link.lastCheck),
                addedAt: formatIST(link.addedAt),
                uptime: `${Math.floor(uptimeHours / 24)}d ${uptimeHours % 24}h`,
                failCount: link.failCount || 0,
                successRate: `${Math.round((((link.totalChecks || 1) - (link.failCount || 0)) / (link.totalChecks || 1)) * 100)}%`
            };
        });

        res.json({
            success: true,
            stats: {
                totalLinks: data.stats.totalLinks,
                activeLinks: data.stats.activeLinks,
                offlineLinks: data.stats.totalLinks - data.stats.activeLinks,
                lastUpdate: formatIST(data.stats.lastUpdate)
            },
            links: summary
        });
    } catch (err) {
        console.error("/all error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// Delete link by code
app.delete("/delete/:code", (req, res) => {
    try {
        const { code } = req.params;
        const data = readLinksData();
        const idx = data.links.findIndex(l => l.code === code.toUpperCase());
        if (idx === -1) return res.status(404).json({ success: false, message: "Invalid code" });

        const removed = data.links.splice(idx, 1)[0];
        data.stats.totalLinks = data.links.length;
        data.stats.activeLinks = data.links.filter(l => l.status === "online").length;
        writeLinksData(data);

        console.log(`🗑️ Deleted link: ${removed.url} (${code})`);
        return res.json({ success: true, message: "Deleted", deletedUrl: removed.url });
    } catch (err) {
        console.error("/delete error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

// ====== BACKGROUND PING SYSTEM ======

async function pingAllLinks() {
    const data = readLinksData();
    if (!data || !Array.isArray(data.links) || data.links.length === 0) {
        console.log("📭 No links to ping");
        return;
    }

    console.log(`🔄 Pinging ${data.links.length} links...`);
    for (let i = 0; i < data.links.length; i++) {
        const link = data.links[i];
        try {
            console.log(`📡 Pinging [${i+1}/${data.links.length}]: ${link.url}`);
            const updated = await updateLinkStatus(link);
            updated.totalChecks = (updated.totalChecks || 0) + 1;
            data.links[i] = updated;
        } catch (err) {
            console.error(`Ping error for ${link.url}:`, err.message || err);
            // mark as failed attempt
            data.links[i].failCount = (data.links[i].failCount || 0) + 1;
            data.links[i].lastCheck = new Date().toISOString();
            data.links[i].status = "offline";
        }
        // small delay to be polite
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    data.stats.activeLinks = data.links.filter(l => l.status === "online").length;
    writeLinksData(data);
    console.log(`✅ Ping cycle completed. Active: ${data.stats.activeLinks}/${data.stats.totalLinks}`);
}

// Ping all links every 10 minutes
const PING_INTERVAL_MIN = 10;
setInterval(pingAllLinks, PING_INTERVAL_MIN * 60 * 1000);

// Initial ping after 30s (if links exist)
setTimeout(pingAllLinks, 30 * 1000);

// Start server
app.listen(PORT, () => {
    console.log(`🚀 KeepAlive Link Manager running at http://localhost:${PORT}`);
    console.log(`📊 API Endpoints:`);
    console.log(`   POST /add - Add new link (body: { "url": "https://..." })`);
    console.log(`   GET /status/:code - Check link status (code returned when adding)`);
    console.log(`   GET /all - Get all links (admin)`);
    console.log(`   DELETE /delete/:code - Delete link`);
    console.log(`   GET /ping - Health check`);
});
