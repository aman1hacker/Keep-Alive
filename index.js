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
const LINKS_FILE = path.join(__dirname, 'links.json');

// Initialize links.json if not exists
function initLinksFile() {
    if (!fs.existsSync(LINKS_FILE)) {
        const initialData = {
            links: [],
            stats: {
                totalLinks: 0,
                activeLinks: 0,
                lastUpdate: new Date().toISOString()
            }
        };
        fs.writeFileSync(LINKS_FILE, JSON.stringify(initialData, null, 2));
        console.log('📄 Created links.json file');
    }
}

// Read links data
function readLinksData() {
    try {
        const data = fs.readFileSync(LINKS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading links data:', error);
        return { links: [], stats: { totalLinks: 0, activeLinks: 0, lastUpdate: new Date().toISOString() } };
    }
}

// Write links data
function writeLinksData(data) {
    try {
        data.stats.lastUpdate = new Date().toISOString();
        fs.writeFileSync(LINKS_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing links data:', error);
        return false;
    }
}

// Generate 6-digit code
function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Check if URL is valid
function isValidUrl(url) {
    try {
        new URL(url);
        return url.includes('onrender.com') || url.includes('herokuapp.com') || url.startsWith('https://');
    } catch {
        return false;
    }
}

// Ping a single URL
async function pingUrl(url) {
    const startTime = Date.now();
    try {
        const response = await axios.get(url, { 
            timeout: 15000,
            headers: { 'User-Agent': 'KeepAlive-Ping-System/1.0' }
        });
        const responseTime = Date.now() - startTime;
        
        return {
            success: true,
            status: 'online',
            responseTime: responseTime,
            statusCode: response.status,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
            success: false,
            status: 'offline',
            responseTime: responseTime,
            error: error.message,
            statusCode: error.response?.status || 0,
            timestamp: new Date().toISOString()
        };
    }
}

// Update link status
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
    
    return linkData;
}

// Initialize
initLinksFile();

// ====== API ENDPOINTS ======

// Health check
app.get("/ping", (req, res) => {
    const data = readLinksData();
    res.json({ 
        status: "KeepAlive System Running ✅", 
        uptime: Math.floor(process.uptime()),
        totalLinks: data.stats.totalLinks,
        activeLinks: data.stats.activeLinks,
        version: "2.0.0"
    });
});

// Add new link
app.post("/add", async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            message: "URL is required" 
        });
    }
    
    if (!isValidUrl(url)) {
        return res.status(400).json({ 
            success: false, 
            message: "Invalid URL format" 
        });
    }
    
    const data = readLinksData();
    
    // Check if URL already exists
    const existingLink = data.links.find(link => link.url === url);
    if (existingLink) {
        return res.status(409).json({ 
            success: false, 
            message: "URL already exists",
            code: existingLink.code
        });
    }
    
    // Generate unique code
    let code;
    do {
        code = generateCode();
    } while (data.links.some(link => link.code === code));
    
    // Test the URL first
    console.log(`🔄 Testing new URL: ${url}`);
    const pingResult = await pingUrl(url);
    
    // Create new link object
    const newLink = {
        code: code,
        url: url,
        addedAt: new Date().toISOString(),
        lastCheck: pingResult.timestamp,
        status: pingResult.status,
        responseTime: pingResult.responseTime,
        statusCode: pingResult.statusCode,
        failCount: pingResult.success ? 0 : 1,
        totalChecks: 1
    };
    
    if (pingResult.success) {
        newLink.lastSuccess = pingResult.timestamp;
    } else {
        newLink.lastError = pingResult.error;
    }
    
    // Add to data
    data.links.push(newLink);
    data.stats.totalLinks = data.links.length;
    data.stats.activeLinks = data.links.filter(link => link.status === 'online').length;
    
    // Save data
    if (writeLinksData(data)) {
        console.log(`✅ Added new link: ${url} with code: ${code}`);
        res.json({ 
            success: true, 
            message: "Link added successfully",
            code: code,
            status: pingResult.status,
            responseTime: pingResult.responseTime
        });
    } else {
        res.status(500).json({ 
            success: false, 
            message: "Failed to save link" 
        });
    }
});

// Get link status by code
app.get("/status/:code", async (req, res) => {
    const { code } = req.params;
    const data = readLinksData();
    
    const link = data.links.find(l => l.code === code.toUpperCase());
    if (!link) {
        return res.status(404).json({ 
            success: false, 
            message: "Invalid code" 
        });
    }
    
    // Update status with fresh ping
    console.log(`🔄 Checking status for: ${link.url}`);
    const updatedLink = await updateLinkStatus(link);
    
    // Update in data array
    const linkIndex = data.links.findIndex(l => l.code === code.toUpperCase());
    data.links[linkIndex] = updatedLink;
    data.links[linkIndex].totalChecks = (data.links[linkIndex].totalChecks || 0) + 1;
    
    // Update stats
    data.stats.activeLinks = data.links.filter(link => link.status === 'online').length;
    
    // Save updated data
    writeLinksData(data);
    
    // Calculate uptime
    const addedTime = new Date(updatedLink.addedAt);
    const now = new Date();
    const uptimeHours = Math.floor((now - addedTime) / (1000 * 60 * 60));
    const uptimeDays = Math.floor(uptimeHours / 24);
    
    res.json({
        success: true,
        data: {
            code: updatedLink.code,
            url: updatedLink.url,
            status: updatedLink.status,
            responseTime: `${updatedLink.responseTime}ms`,
            lastCheck: updatedLink.lastCheck,
            lastSuccess: updatedLink.lastSuccess || "Never",
            addedAt: updatedLink.addedAt,
            uptime: `${uptimeDays}d ${uptimeHours % 24}h`,
            failCount: updatedLink.failCount || 0,
            totalChecks: updatedLink.totalChecks || 1,
            successRate: `${Math.round((((updatedLink.totalChecks || 1) - (updatedLink.failCount || 0)) / (updatedLink.totalChecks || 1)) * 100)}%`
        }
    });
});

// Get all links (Admin)
app.get("/all", (req, res) => {
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
            lastCheck: link.lastCheck,
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
            lastUpdate: data.stats.lastUpdate
        },
        links: summary
    });
});

// Delete link by code
app.delete("/delete/:code", (req, res) => {
    const { code } = req.params;
    const data = readLinksData();
    
    const linkIndex = data.links.findIndex(l => l.code === code.toUpperCase());
    if (linkIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            message: "Invalid code" 
        });
    }
    
    const deletedLink = data.links.splice(linkIndex, 1)[0];
    data.stats.totalLinks = data.links.length;
    data.stats.activeLinks = data.links.filter(link => link.status === 'online').length;
    
    if (writeLinksData(data)) {
        console.log(`🗑️ Deleted link: ${deletedLink.url} (${code})`);
        res.json({ 
            success: true, 
            message: `Link deleted successfully`,
            deletedUrl: deletedLink.url
        });
    } else {
        res.status(500).json({ 
            success: false, 
            message: "Failed to delete link" 
        });
    }
});

// ====== BACKGROUND PING SYSTEM ======

async function pingAllLinks() {
    const data = readLinksData();
    
    if (data.links.length === 0) {
        console.log('📭 No links to ping');
        return;
    }
    
    console.log(`🔄 Pinging ${data.links.length} links...`);
    
    for (let i = 0; i < data.links.length; i++) {
        const link = data.links[i];
        console.log(`📡 Pinging [${i+1}/${data.links.length}]: ${link.url}`);
        
        const updatedLink = await updateLinkStatus(link);
        updatedLink.totalChecks = (updatedLink.totalChecks || 0) + 1;
        data.links[i] = updatedLink;
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Update stats
    data.stats.activeLinks = data.links.filter(link => link.status === 'online').length;
    
    // Save updated data
    writeLinksData(data);
    
    console.log(`✅ Ping cycle completed. Active: ${data.stats.activeLinks}/${data.stats.totalLinks}`);
}

// Ping all links every 10 minutes
setInterval(pingAllLinks, 10 * 60 * 1000); // 10 minutes

// Initial ping after 30 seconds
setTimeout(pingAllLinks, 30000);

// Start server
app.listen(PORT, () => {
    console.log(`🚀 KeepAlive Link Manager running at http://localhost:${PORT}`);
    console.log(`📊 API Endpoints:`);
    console.log(`   POST /add - Add new link`);
    console.log(`   GET /status/:code - Check link status`);
    console.log(`   GET /all - Get all links (admin)`);
    console.log(`   DELETE /delete/:code - Delete link`);
    console.log(`   GET /ping - Health check`);
});
