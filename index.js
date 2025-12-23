const express = require("express");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ============================================
// MONGODB CONNECTION & SCHEMA
// ============================================

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

const UserSchema = new mongoose.Schema({
    id: Number,
    username: String,
    role: String,
    hintCoins: Number,
    isPlayer: Boolean,
    notes: String,
    sessionId: String // New field for isolation
});

const User = mongoose.model("User", UserSchema);

// Persistent Admin Seeding (Shared Bank)
const initGlobalAdmin = async () => {
    try {
        const admin = await User.findOne({ id: 1 });
        if (!admin) {
            await User.create({ id: 1, username: "admin", role: "admin", hintCoins: 10000, isPlayer: false, notes: "psst: this _id is the master key for Level 4" });
            console.log("✅ Global Admin Created (10,000 coins)");
        }
    } catch (err) {
        console.error("❌ Admin Init Error:", err);
    }
};
initGlobalAdmin();

// ============================================
// SESSION & GAME STATE MANAGEMENT
// ============================================

// In-memory store for game state per session
// { "uuid": { level1Completed: false, ... } }
const sessions = {};

app.use(async (req, res, next) => {
    let sid = req.cookies.buggit_session;

    if (!sid || !sessions[sid]) {
        sid = sid || crypto.randomUUID();
        res.cookie("buggit_session", sid, { httpOnly: true });

        // Init Session State
        sessions[sid] = {
            level1Completed: false,
            level2Completed: false,
            level3Completed: false,
            level4Completed: false,
            overloadCounter: 0,
            fakeRateLimit: 0,
            lastFakeTime: Date.now()
        };
        console.log(`🆕 New Session: ${sid}`);
    }

    req.sessionID = sid;
    req.gameState = sessions[sid];

    // Ensure Database User Exists for this Session
    // We lazily create the player user in DB if missing needed
    if (req.path.startsWith('/api') || req.path === '/level3.html') {
        let player = await User.findOne({ sessionId: sid });
        if (!player) {
            await User.create({
                id: Math.floor(Math.random() * 100000) + 10, // Assign random ID to avoid unique index component collisions (backend maps ID 5 to this user)
                sessionId: sid,
                username: "player",
                role: "user",
                hintCoins: 0,
                isPlayer: true
            });
        }
    }

    next();
});


// ============================================
// TRAP PAGES
// ============================================

app.get("/level2.html", (req, res) => res.send(trapPage("🚫", "ACCESS RESTRICTED", "Direct access forbidden. Authenticate via Gateway.")));
app.get("/level3.html", (req, res) => res.send(trapPage("🏦", "VAULT SEALED", "Authorization credentials missing.")));
app.get("/level4.html", (req, res) => res.send(trapPage("☣️", "BIOHAZARD LOCKDOWN", "Level 4 Isolation Active.")));
app.get("/success_next_level", (req, res) => res.send(trapPage("⚠️", "DECOY TRIGGERED", "Simple SQL injection detected and routed to honeypot. <br>The second layer requires a precise key, not a broken lock.")));
app.get("/door_opened", (req, res) => res.send(trapPage("🛡️", "SIMULATION DETECTED", "You targeted the decoy file. <br>The real mechanism requires escaping the isolated sandbox.")));
app.get("/flag", (req, res) => res.send(trapPage("🏴‍☠️", "NO SHORTCUTS", "Do you think it is so easy? <br>Try harder.")));
app.get("/level3_access", (req, res) => res.send(trapPage("🎭", "SYNTAX ERROR", "Traversal pattern recognized but target incorrect.")));

function trapPage(icon, title, msg) {
    return `<html><body style="background:#0a0a0f;color:#ff4444;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
        <div><h1 style="font-size:4rem;">${icon}</h1><h2>${title}</h2><p style="color:#888;max-width:400px;line-height:1.8;">${msg}</p><a href="javascript:history.back()" style="color:#00ff88;display:inline-block;margin-top:20px;">← RETURN</a></div></body></html>`;
}

app.use(express.static("public"));

// ============================================
// CLEAN ROUTING
// ============================================

app.get("/secure_storage", (req, res) => {
    if (!req.gameState.level1Completed) return res.redirect('/level2.html');
    res.sendFile(path.join(__dirname, "public", "level2.html"));
});

app.get("/shadow_ledger", (req, res) => {
    if (!req.gameState.level2Completed) return res.redirect('/level3.html');
    res.sendFile(path.join(__dirname, "public", "level3.html"));
});

app.get("/containment_zone", (req, res) => {
    if (!req.gameState.level3Completed) return res.redirect('/level4.html');
    res.sendFile(path.join(__dirname, "public", "level4.html"));
});

// ============================================
// LOGIC: LEVEL 1
// ============================================

app.post("/api/level1/login", (req, res) => {
    const { username, password, step } = req.body;

    if (step === "1") {
        const lowerUser = username.toLowerCase();
        if (/['"]\s*or\s*['"]|['"]\s*or\s*\d|\d\s*=\s*\d|['"]\s*=\s*['"]/.test(lowerUser) || lowerUser.includes("' or") || lowerUser.includes(" or ")) {
            return res.json({ success: true, message: "✅ ACCESS PATTERN RECOGNIZED. Protocol Override Initiated.", nextStep: 2 });
        }
        return res.json({ success: false, message: "⛔ ACCESS DENIED. Standard authentication failed." });
    }

    if (step === "2") {
        if (password === "CDC=BEST_CLUB") {
            req.gameState.level1Completed = true;
            return res.json({ success: true, message: "🎉 SYSTEM OVERRIDE SUCCESSFUL.", rewardPath: "/secure_storage", bounty: "BOUNTY{gate_breached}" });
        }
        if (password.toLowerCase().includes(" or ") || password.includes("1=1")) {
            return res.json({ success: true, message: "🎉 ACCESS GRANTED!", rewardPath: "/success_next_level", bounty: "BOUNTY{sql_master}" });
        }
        return res.json({ success: false, message: "⛔ OVERRIDE FAILURE. Security credentials rejected." });
    }
    res.json({ success: false, message: "Invalid step" });
});

// ============================================
// LOGIC: LEVEL 2
// ============================================

app.post("/api/level2/delete", (req, res) => {
    const { filename } = req.body;
    if (!req.gameState.level1Completed) return res.status(403).json({ success: false, message: "Access denied." });

    if (filename === "../lock.bug") {
        try { if (fs.existsSync("lock.bug")) fs.unlinkSync("lock.bug"); } catch (e) { }
        req.gameState.level2Completed = true;
        return res.json({ success: true, message: "🔓 PHYSICAL BARRIER REMOVED.", rewardPath: "/shadow_ledger", bounty: "BOUNTY{walls_crumbled}" });
    }

    if (filename === "lock.txt" || filename === "lock") {
        return res.json({ success: true, message: "🔓 LOCK DESTROYED! (Decoy)", rewardPath: "/door_opened", bounty: "BOUNTY{lock_picked_sim}" });
    }
    return res.json({ success: false, message: "Error: File not found or protected." });
});

// ============================================
// LOGIC: LEVEL 3
// ============================================

app.get("/api/level3/user/:id", async (req, res) => {
    if (!req.gameState.level2Completed) return res.status(403).json({ success: false });

    // Logic: If asking for ID 5 (Player), return Session Player. 
    // If asking for ID 1 (Admin), return Global Admin.

    let user;
    if (req.params.id == 5) {
        user = await User.findOne({ sessionId: req.sessionID });
    } else {
        user = await User.findOne({ id: req.params.id });
    }

    if (!user) return res.json({ success: false });
    res.json({ success: true, user: { username: user.username, hintCoins: user.hintCoins, role: user.role } });
});

app.patch("/api/level3/user/:id/steal", async (req, res) => {
    if (!req.gameState.level2Completed) return res.status(403).json({ success: false });

    if (req.params.id == 5) return res.json({ success: false, message: "Cannot steal from yourself" });

    // Target: Usually Admin (ID 1)
    const target = await User.findOne({ id: req.params.id });

    // Player: Session Player
    const player = await User.findOne({ sessionId: req.sessionID });

    if (!target || !player) return res.json({ success: false, message: "User not found" });

    if (target.hintCoins < 25) {
        return res.json({ success: false, message: "Target is bankrupt!" });
    }

    const stealAmount = 25;
    target.hintCoins -= stealAmount;
    player.hintCoins += stealAmount;

    await target.save();
    await player.save();

    res.json({
        success: true,
        message: `💰 Acquired ${stealAmount} coins`,
        leakedData: target,
        yourCoins: player.hintCoins
    });
});

app.post("/api/level3/getbounty", async (req, res) => {
    if (!req.gameState.level2Completed) return res.status(403).json({ success: false });

    const player = await User.findOne({ sessionId: req.sessionID });
    if (player.hintCoins < 25) {
        return res.json({ success: false, message: `Insufficient funds: ${player.hintCoins}/25.` });
    }

    player.hintCoins -= 25;
    await player.save();

    req.gameState.level3Completed = true;

    res.json({
        success: true,
        message: "🏆 VAULT UNLOCKED.",
        rewardPath: "/containment_zone",
        bounty: "BOUNTY{mongo_idor_king}"
    });
});

// ============================================
// LOGIC: LEVEL 4
// ============================================

app.post("/api/level4/spreadParamecium", async (req, res) => {
    if (!req.gameState.level3Completed) return res.status(403).json({ success: false });

    const { adminId } = req.body;

    // Fake Logic (Rate Limited per session)
    if (!adminId) {
        const now = Date.now();
        if (now - req.gameState.lastFakeTime > 30000) {
            req.gameState.fakeRateLimit = 0;
            req.gameState.lastFakeTime = now;
        }
        if (req.gameState.fakeRateLimit >= 10) return res.json({ success: false, message: "RATE LIMIT EXCEEDED.", level: Math.floor(Math.random() * 20) });

        req.gameState.fakeRateLimit++;
        return res.json({ success: false, message: "Infection spreading... (Ineffective)", level: Math.floor(Math.random() * 30) });
    }

    // Real Logic
    try {
        const adminUser = await User.findById(adminId);

        if (adminUser && adminUser.role === 'admin') {
            req.gameState.overloadCounter++;

            if (req.gameState.overloadCounter >= 40) {
                req.gameState.level4Completed = true;
                return res.json({ success: true, level: 100, message: "SYSTEM MELTDOWN CONFIRMED.", bounty: "BOUNTY{mongoose_admin_overlord}" });
            }

            return res.json({ success: true, level: Math.min(99, req.gameState.overloadCounter * 2.5), message: "OVERLOAD IN PROGRESS..." });
        } else {
            return res.json({ success: false, message: "INVALID AUTH CODE." });
        }
    } catch (e) {
        return res.json({ success: false, message: "MALFORMED ID." });
    }
});

app.get("/api/level4/status", (req, res) => {
    if (req.gameState.level4Completed) {
        return res.json({ completed: true, bounty: "BOUNTY{mongoose_admin_overlord}" });
    }
    res.json({ completed: false, level: req.gameState.overloadCounter });
});

// Session-based Reset
app.post("/api/reset", async (req, res) => {
    // Only reset CURRENT session
    if (req.cookies.buggit_session && sessions[req.cookies.buggit_session]) {
        sessions[req.cookies.buggit_session] = {
            level1Completed: false,
            level2Completed: false,
            level3Completed: false,
            level4Completed: false,
            overloadCounter: 0,
            fakeRateLimit: 0,
            lastFakeTime: Date.now()
        };
        // Reset Player Coins
        await User.deleteOne({ sessionId: req.cookies.buggit_session });
    }

    // Ensure lock file exists (global, unavoidable for file system, but game state checks session)
    try { if (!fs.existsSync("lock.bug")) fs.writeFileSync("lock.bug", "LOCKED"); } catch (e) { }

    res.json({ success: true, message: "Session Reset." });
});

app.get("/api/status", (req, res) => {
    res.json({
        level1: req.gameState.level1Completed,
        level2: req.gameState.level2Completed || !fs.existsSync("lock.bug"),
        level3: req.gameState.level3Completed,
        level4: req.gameState.level4Completed
    });
});

// Keep-Alive Ping
app.get("/ping", (req, res) => {
    res.status(200).send("Pong");
});

// Self-Ping every 10 minutes (600,000 ms)
setInterval(() => {
    fetch("https://paramecium.onrender.com/ping")
        .then(res => console.log(`🏓 Keep-Alive Ping: ${res.status}`))
        .catch(err => console.error("❌ Keep-Alive Error:", err.message));
}, 600000);

app.listen(3000, () => {
    console.log("🎮 BUGGIT Server running on http://localhost:3000");
});
