require("dotenv").config();
require("./db");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const { Cashfree } = require("cashfree-pg");


const app = express();

/* =========================
MODELS - Load models first
========================= */
const User = require("./models/User");
const Bet = require("./models/Bet");
const Round = require("./models/Round");
const Withdraw = require("./models/Withdraw");
const Deposit = require("./models/Deposit");
const Referral = require("./models/Referral");
const MonitorUser = require("./models/MonitorUser");
const MonitorActivity = require("./models/MonitorActivity");
// ✅ ADD THESE NEW MODELS
const RahulModiBet = require("./models/RahulModiBet");
const RahulModiRound = require("./models/RahulModiRound");


/* =========================
MIDDLEWARE - MUST BE BEFORE ROUTES
========================= */
const auth = require("./middleware/auth");
/* =========================
APP SETUP
========================= */
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});



// Admin Auth
function adminAuth(req, res, next) {
    try {
        const token = req.headers.authorization?.replace("Bearer ", "");
        if (!token) {
            return res.status(401).json({ error: "Admin token missing" });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== "admin") {
            return res.status(403).json({ error: "Admin access denied" });
        }
        req.admin = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid admin token" });
    }
}

// Monitor Auth
const authenticateMonitor = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const monitor = await MonitorUser.findOne({
            username: decoded.username,
            active: true
        });
        if (!monitor) {
            return res.status(401).json({ error: 'Invalid or inactive monitor user' });
        }
        req.monitor = monitor;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
// ============================================
// MONITOR LOGIN & AUTHENTICATION
// ============================================
// Monitor Login
app.post('/monitor/login', async (req, res) => {
    try {
        console.log('Monitor login attempt:', req.body.username);
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const monitor = await MonitorUser.findOne({ username });
        console.log('Monitor found:', monitor ? 'Yes' : 'No');

        if (!monitor || !monitor.active) {
            return res.status(401).json({ error: 'Invalid credentials or account disabled' });
        }

        const isValid = await bcrypt.compare(password, monitor.password);
        console.log('Password valid:', isValid);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update login stats
        monitor.totalLogins += 1;
        monitor.lastLogin = new Date();
        await monitor.save();

        // Log activity
        await MonitorActivity.create({
            username: monitor.username,
            action: 'LOGIN',
            ipAddress: req.ip
        });

        // Generate token
        const token = jwt.sign(
            { username: monitor.username, role: 'monitor' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('Monitor login successful');

        res.json({
            success: true,
            token,
            user: {
                username: monitor.username,
                displayName: monitor.displayName
            }
        });
    } catch (err) {
        console.error('Monitor login error:', err);
        res.status(500).json({ error: 'Login failed: ' + err.message });
    }
});


// ============================================
// LIVE BETTING MONITOR ENDPOINTS
// ============================================

// Get Live Bets for Current Round
app.get('/monitor/live-bets', authenticateMonitor, async (req, res) => {
    try {
        const bets = await Bet.find({
            roundId: CURRENT_ROUND.id,
            status: 'PENDING'
        })
            .sort({ createdAt: -1 })
            .limit(100);

        const redBets = bets
            .filter(bet => bet.color === 'red')
            .map(bet => ({
                id: bet._id,
                mobile: bet.mobile,
                amount: bet.amount,
                time: bet.createdAt
            }));

        const greenBets = bets
            .filter(bet => bet.color === 'green')
            .map(bet => ({
                id: bet._id,
                mobile: bet.mobile,
                amount: bet.amount,
                time: bet.createdAt
            }));

        // Log activity
        await MonitorActivity.create({
            username: req.monitor.username,
            action: 'VIEW_BETS',
            ipAddress: req.ip
        });

        res.json({ red: redBets, green: greenBets });
    } catch (err) {
        console.error('Live bets error:', err);
        res.status(500).json({ error: 'Failed to fetch live bets' });
    }
});

// Get Current Round Stats
app.get('/monitor/round-stats', authenticateMonitor, async (req, res) => {
    try {
        const bets = await Bet.find({
            roundId: CURRENT_ROUND.id,
            status: 'PENDING'
        });

        const redBets = bets.filter(b => b.color === 'red');
        const greenBets = bets.filter(b => b.color === 'green');

        const redTotal = redBets.reduce((sum, b) => sum + b.amount, 0);
        const greenTotal = greenBets.reduce((sum, b) => sum + b.amount, 0);

        const uniquePlayers = new Set(bets.map(b => b.mobile)).size;

        res.json({
            redTotal,
            greenTotal,
            redBets: redBets.length,
            greenBets: greenBets.length,
            totalPlayers: uniquePlayers,
            potentialPayout: Math.max(redTotal * 1.96, greenTotal * 1.96)
        });
    } catch (err) {
        console.error('Round stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ============================================
// ADMIN ENDPOINTS - MONITOR USER MANAGEMENT
// ============================================

// Get All Monitor Users (Admin Only)
app.get('/admin/monitor-users', adminAuth, async (req, res) => {
    try {
        console.log('Fetching monitor users for admin:', req.admin.username);
        
        const monitors = await MonitorUser.find()
            .select('-password')
            .sort({ createdAt: -1 });

        console.log('Found', monitors.length, 'monitor users');
        res.json(monitors);
    } catch (err) {
        console.error('Get monitors error:', err);
        res.status(500).json({ error: 'Failed to fetch monitor users: ' + err.message });
    }
});

// Create Monitor User (Admin Only)
app.post('/admin/monitor-user', adminAuth, async (req, res) => {
    try {
        console.log('Creating monitor user:', req.body);
        const { username, password, displayName } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Check if username exists
        const existing = await MonitorUser.findOne({ username });
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const monitor = await MonitorUser.create({
            username,
            password: hashedPassword,
            displayName: displayName || username
        });

        // Log activity
        await MonitorActivity.create({
            username: req.admin.username || 'admin',
            action: `CREATED monitor user: ${username}`,
            ipAddress: req.ip
        });

        console.log('Monitor user created successfully');

        res.json({
            success: true,
            monitor: {
                _id: monitor._id,
                username: monitor.username,
                displayName: monitor.displayName,
                active: monitor.active
            }
        });
    } catch (err) {
        console.error('Create monitor error:', err);
        res.status(500).json({ error: 'Failed to create monitor user: ' + err.message });
    }
});


// Update Monitor User (Admin Only)
app.put('/admin/monitor-user/:id', adminAuth, async (req, res) => {
    try {
        console.log('Updating monitor user:', req.params.id, req.body);
        const { username, password, displayName } = req.body;

        const monitor = await MonitorUser.findById(req.params.id);
        if (!monitor) {
            return res.status(404).json({ error: 'Monitor user not found' });
        }

        // Update fields
        if (username) monitor.username = username;
        if (displayName) monitor.displayName = displayName;
        if (password && password.length >= 6) {
            monitor.password = await bcrypt.hash(password, 10);
        }

        await monitor.save();

        // Log activity
        await MonitorActivity.create({
            username: req.admin.username || 'admin',
            action: `UPDATED monitor user: ${monitor.username}`,

            ipAddress: req.ip
        });

        console.log('Monitor user updated successfully');

        res.json({ 
            success: true, 
            monitor: {
                _id: monitor._id,
                username: monitor.username,
                displayName: monitor.displayName,
                active: monitor.active
            }
        });
    } catch (err) {
        console.error('Update monitor error:', err);
        res.status(500).json({ error: 'Failed to update monitor user: ' + err.message });
    }
});

// Toggle Monitor User Active Status (Admin Only)
app.post('/admin/monitor-user/:id/toggle', adminAuth, async (req, res) => {
    try {
        console.log('Toggling monitor user:', req.params.id, req.body);
        const { active } = req.body;

        const monitor = await MonitorUser.findById(req.params.id);
        if (!monitor) {
            return res.status(404).json({ error: 'Monitor user not found' });
        }

        monitor.active = active;
        await monitor.save();

        // Log activity
        await MonitorActivity.create({
            username: req.admin.username || 'admin',
            action: `${active ? 'ENABLED' : 'DISABLED'} monitor user: ${monitor.username}`,

      ipAddress: req.ip
        });

        console.log('Monitor user toggled successfully');

        res.json({ 
            success: true, 
            monitor: {
                _id: monitor._id,
                username: monitor.username,
                displayName: monitor.displayName,
                active: monitor.active
            }
        });
    } catch (err) {
        console.error('Toggle monitor error:', err);
        res.status(500).json({ error: 'Failed to toggle monitor user: ' + err.message });
    }
});

// Delete Monitor User (Admin Only)
app.delete('/admin/monitor-user/:id', adminAuth, async (req, res) => {
    try {
        console.log('Deleting monitor user:', req.params.id);

        const monitor = await MonitorUser.findById(req.params.id);
        if (!monitor) {
            return res.status(404).json({ error: 'Monitor user not found' });
        }

        const username = monitor.username;
        await MonitorUser.deleteOne({ _id: req.params.id });

        // Log activity
        await MonitorActivity.create({
            username: req.admin.username || 'admin',
           action: `DELETED monitor user: ${username}`,

            ipAddress: req.ip
        });

        console.log('Monitor user deleted successfully');

        res.json({ success: true });
    } catch (err) {
        console.error('Delete monitor error:', err);
        res.status(500).json({ error: 'Failed to delete monitor user: ' + err.message });
    }
});

// Get Monitor Activity Log (Admin Only)
app.get('/admin/monitor-activity', adminAuth, async (req, res) => {
    try {
        console.log('Fetching monitor activity log');

        const activities = await MonitorActivity.find()
            .sort({ timestamp: -1 })
            .limit(50);

        console.log('Found', activities.length, 'activities');

        res.json(activities);
    } catch (err) {
        console.error('Activity log error:', err);
        res.status(500).json({ error: 'Failed to fetch activity log: ' + err.message });
    }
});

/* =========================
CASHFREE CONFIGURATION
========================= */
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment = Cashfree.Environment.PRODUCTION;

/* =========================
CONSTANTS
========================= */
// ✅ FIX #2: REDUCED COMMISSION RATES (HALVED)
const COMMISSION_RATES = {
  1: 0.05, // 5% (was 10%)
  2: 0.025, // 2.5% (was 5%)
  3: 0.015, // 1.5% (was 3%)
  4: 0.01, // 1% (was 2%)
  5: 0.005, // 0.5% (was 1%)
  6: 0.005  // 0.5% (was 1%)
};
/* =========================
SEQUENTIAL ROUND ID GENERATOR - ADD THIS
========================= */
let CURRENT_ROUND_NUMBER = null;

async function getNextRoundId() {
    try {
        if (CURRENT_ROUND_NUMBER === null) {
            const latestRound = await Round.findOne()
                .sort({ createdAt: -1 })
                .select('roundId');
            
            if (latestRound && latestRound.roundId) {
                const lastNumber = parseInt(latestRound.roundId);
                CURRENT_ROUND_NUMBER = lastNumber + 1;
            } else {
                CURRENT_ROUND_NUMBER = 100000;
            }
        } else {
            CURRENT_ROUND_NUMBER++;
        }
        
        return CURRENT_ROUND_NUMBER.toString();
    } catch (err) {
        console.error('Error getting next round ID:', err);
        return Date.now().toString();
    }
}
/* =========================
PROCESS REFERRAL COMMISSION
========================= */
// ✅ FIX #3: REFERRAL EARNINGS ARE NOW WAGER-FREE (Added directly to wallet)
async function processReferralCommission(userId, amount, type) {
  try {
    const user = await User.findOne({ mobile: userId });
    if (!user || !user.referredBy) return;
    
    let currentReferrer = user.referredBy;
    let level = 1;
    
    while (currentReferrer && level <= 6) {
      const referrer = await User.findOne({ referralCode: currentReferrer });
      if (!referrer) break;
      
      const commission = Math.round(amount * COMMISSION_RATES[level] * 100) / 100;
      
      // ✅ FIX #3: Add commission directly to wallet (wager-free)
      referrer.wallet = Math.round((referrer.wallet + commission) * 100) / 100;
      referrer.referralEarnings = Math.round((referrer.referralEarnings + commission) * 100) / 100;
      await referrer.save();
      
      await Referral.create({
        userId: referrer.mobile,
        fromUser: userId,
        level,
        commission,
        type,
        createdAt: new Date()
      });
      
      console.log(`💰 Level ${level} commission: ${referrer.mobile.substring(0,4)}**** earned ₹${commission} from ${userId.substring(0,4)}****`);
      
      currentReferrer = referrer.referredBy;
      level++;
    }
  } catch (err) {
    console.error('Referral commission error:', err);
  }
}

/* =========================
ROUND STATE
========================= */
/* NEW CODE - USE THIS: */
let CURRENT_ROUND = {
    id: null,
    startTime: Date.now()
};

/* ✅ Rahul Modi Game - NEW */
let RAHUL_MODI_ROUND = {
  id: null,
  startTime: Date.now()
};

/* =========================
RAHUL MODI ROUND ID GENERATOR
========================= */
let CURRENT_RAHUL_MODI_ROUND_NUMBER = null;

async function getNextRahulModiRoundId() {
  try {
    if (CURRENT_RAHUL_MODI_ROUND_NUMBER === null) {
      const latestRound = await RahulModiRound.findOne()
        .sort({ createdAt: -1 })
        .select('roundId');
      
      if (latestRound && latestRound.roundId) {
        const lastNumber = parseInt(latestRound.roundId);
        CURRENT_RAHUL_MODI_ROUND_NUMBER = lastNumber + 1;
      } else {
        CURRENT_RAHUL_MODI_ROUND_NUMBER = 200000; // Different starting number
      }
    } else {
      CURRENT_RAHUL_MODI_ROUND_NUMBER++;
    }
    
    return CURRENT_RAHUL_MODI_ROUND_NUMBER.toString();
  } catch (err) {
    console.error('Error getting next Rahul Modi round ID:', err);
    return Date.now().toString();
  }
}

// ✅ FIX #4: ADD ENDPOINT TO GET CURRENT ROUND WITH ACTUAL TIME LEFT
app.get("/round/current", async (req, res) => {
  try {
    const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
    const timeLeft = Math.max(0, 60 - elapsed);
    
    res.json({
      id: CURRENT_ROUND.id,
      startTime: CURRENT_ROUND.startTime,
      timeLeft: timeLeft
    });
  } catch (err) {
    console.error("Current round error:", err);
    res.status(500).json({ error: "Failed to get current round" });
  }
});

/* =========================
CASHFREE WEBHOOK
========================= */ 
app.post("/api/cashfree/webhook", async (req, res) => {
  try {
    console.log("✅ Cashfree Webhook Received:", JSON.stringify(req.body));
    const eventData = req.body?.data;
    const orderId = eventData?.order?.order_id;
    const paymentStatus = eventData?.payment?.payment_status;
    const paidAmount = Number(eventData?.order?.order_amount || 0);

    if (!orderId) {
      return res.status(400).send("Missing order_id");
    }

    const deposit = await Deposit.findOne({ referenceId: orderId });
    
    if (!deposit) {
      console.log("⚠️ Deposit not found for order:", orderId);
      return res.status(200).send("OK");
    }

    if (deposit.status === "SUCCESS") {
      return res.status(200).send("OK");
    }

    if (paymentStatus === "SUCCESS") {
      const user = await User.findOne({ mobile: deposit.mobile });
      
      if (!user) {
        console.log("⚠️ User not found:", deposit.mobile);
        return res.status(200).send("OK");
      }

      deposit.status = "SUCCESS";
      await deposit.save();

      const amountToAdd = paidAmount || deposit.amount;
      user.wallet = Math.round((user.wallet + amountToAdd) * 100) / 100;
      user.deposited = true;
      user.depositAmount = Math.round(((user.depositAmount || 0) + amountToAdd) * 100) / 100;

     const isFirstDeposit = user.depositAmount === amountToAdd;
if (isFirstDeposit) {
  // ✅ FIX #2: FIRST DEPOSIT BONUS IS NOW 20% (was 100%)
  const bonusAmount = amountToAdd * 0.20; // 20% bonus
  user.bonus = Math.round(((user.bonus || 0) + bonusAmount) * 100) / 100;
  console.log(`🎁 First Deposit Bonus: ${user.mobile} received ₹${bonusAmount.toFixed(2)} (20% of ₹${amountToAdd})`);
}
      await user.save();
      await processReferralCommission(user.mobile, amountToAdd, "DEPOSIT");

      console.log(`✅ Cashfree Deposit SUCCESS: ${user.mobile} +₹${amountToAdd}`);
    } else {
      deposit.status = "FAILED";
      await deposit.save();
      console.log(`❌ Cashfree Deposit FAILED: ${orderId}`);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Cashfree webhook error:", err);
    return res.status(200).send("OK");
  }
});

/* =========================
CREATE CASHFREE ORDER - ENHANCED WITH DEBUGGING
========================= */
app.post("/api/cashfree/create-order", auth, async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Validate amount
    if (!amount || Number(amount) < 100) {
      return res.status(400).json({ 
        success: false,
        message: "Minimum deposit ₹100" 
      });
    }
    
    // Find user
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "User not found" 
      });
    }
    
    // Generate unique order ID
    const orderId = `ORDER_${Date.now()}_${user.mobile.slice(-4)}`;
    
    // Prepare order request
    const orderRequest = {
      order_amount: Number(amount),
      order_currency: "INR",
      order_id: orderId,
      customer_details: {
        customer_id: user.mobile,
        customer_phone: user.mobile,
        customer_email: user.email || `user${user.mobile}@bigwin.in`,
        customer_name: user.name || `User ${user.mobile.slice(-4)}`
      }
    };
    
    console.log('📝 Creating Cashfree order...');
    console.log('Order Request:', JSON.stringify(orderRequest, null, 2));
    console.log('Environment:', Cashfree.XEnvironment);
    console.log('Client ID:', Cashfree.XClientId ? 'Set ✅' : 'Missing ❌');
    console.log('Client Secret:', Cashfree.XClientSecret ? 'Set ✅' : 'Missing ❌');
    
    // Create order with Cashfree
    const response = await Cashfree.PGCreateOrder("2023-08-01", orderRequest);
    
    console.log('Cashfree Response:', JSON.stringify(response.data, null, 2));
    
    // Check if payment_session_id exists
    if (!response.data || !response.data.payment_session_id) {
      console.error('❌ No payment_session_id in response:', response.data);
      return res.status(500).json({
        success: false,
        message: "Payment gateway error - no session ID",
        error: "Invalid response from payment gateway"
      });
    }
    
    // Save deposit record
    const deposit = await Deposit.create({
      mobile: user.mobile,
      amount: Number(amount),
      method: "cashfree",
      referenceId: orderId,
      status: "PENDING",
    });
    
    console.log(`✅ Cashfree order created: ${orderId}`);
    console.log(`💾 Deposit record saved: ${deposit._id}`);
    
    // Return successful response
    return res.json({
      success: true,
      orderId: orderId,
      payment_session_id: response.data.payment_session_id,
      order_status: response.data.order_status || 'ACTIVE',
      order_token: response.data.order_token,
      amount: Number(amount)
    });
    
  } catch (err) {
    console.error("❌ Cashfree Error Details:");
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    
    // Log response details if available
    if (err.response) {
      console.error("Response Status:", err.response.status);
      console.error("Response Headers:", err.response.headers);
      console.error("Response Data:", JSON.stringify(err.response.data, null, 2));
    }
    
    // Check for specific error types
    let errorMessage = "Payment gateway error";
    let errorDetails = err.message;
    
    if (err.response?.status === 401) {
      errorMessage = "Payment gateway authentication failed";
      errorDetails = "Invalid credentials. Please contact support.";
      console.error("🔑 Authentication Error - Check your CASHFREE_APP_ID and CASHFREE_SECRET_KEY");
    } else if (err.response?.status === 400) {
      errorMessage = "Invalid payment request";
      errorDetails = err.response.data?.message || "Invalid order details";
    }
    
    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: errorDetails
    });
  }
});

// Manual API Method (Alternative)
app.post("/api/cashfree/create-order-manual", auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const axios = require('axios');
    
    if (!amount || Number(amount) < 100) {
      return res.status(400).json({ 
        success: false,
        message: "Minimum deposit ₹100" 
      });
    }
    
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "User not found" 
      });
    }
    
    const orderId = `ORDER_${Date.now()}_${user.mobile.slice(-4)}`;
    
    const cashfreeUrl = process.env.NODE_ENV === 'production' 
      ? 'https://api.cashfree.com/pg/orders'
      : 'https://sandbox.cashfree.com/pg/orders';
    
    const orderData = {
      order_amount: Number(amount),
      order_currency: "INR",
      order_id: orderId,
      customer_details: {
        customer_id: user.mobile,
        customer_phone: user.mobile,
        customer_email: user.email || `user${user.mobile}@bigwin.in`,
        customer_name: user.name || `User ${user.mobile.slice(-4)}`
      }
    };
    
    console.log('Making manual API request to:', cashfreeUrl);
    console.log('Order data:', orderData);
    
    const response = await axios.post(cashfreeUrl, orderData, {
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01'
      }
    });
    
    console.log('Response:', response.data);
    
    if (!response.data.payment_session_id) {
      throw new Error('No payment_session_id received');
    }
    
    await Deposit.create({
      mobile: user.mobile,
      amount: Number(amount),
      method: "cashfree",
      referenceId: orderId,
      status: "PENDING",
    });
    
    return res.json({
      success: true,
      orderId: orderId,
      payment_session_id: response.data.payment_session_id,
      order_status: response.data.order_status
    });
    
  } catch (err) {
    console.error("Manual API Error:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: "Payment gateway error",
      error: err.response?.data || err.message
    });
  }
});
/* NOW THE REST OF YOUR ROUTES... */
/* =========================
BASIC
========================= */
app.use(express.json());
app.get("/", (req, res) => {
res.send("BIGWIN backend running - All systems operational ✅");
}); 
// Add this TEST endpoint to check if monitor routes are working
app.get('/admin/test-monitor', adminAuth, async (req, res) => {
    res.json({ 
        message: 'Monitor endpoints are working!',
        bcryptAvailable: !!require('bcryptjs'),
        adminUser: req.admin.username
    });
});
/* =========================
AUTH – USER
========================= */
app.post('/register', async (req, res) => {
try {
const { mobile, password, referralCode } = req.body;
if (!mobile || !password) {
return res.status(400).json({ message: 'Mobile and password required' });
}
if (!/^[0-9]{10}$/.test(mobile)) {
return res.status(400).json({ message: 'Invalid mobile number. Must be 10 digits.' });
}
if (password.length < 6) {
return res.status(400).json({ message: 'Password must be at least 6 characters' });
}
const existing = await User.findOne({ mobile });
if (existing) {
return res.status(400).json({ message: 'Mobile number already registered' });
}
const generateReferralCode = () => {
return 'BW' + Math.random().toString(36).substring(2, 11).toUpperCase();
};
let uniqueCode = generateReferralCode();
let codeExists = await User.findOne({ referralCode: uniqueCode });
while (codeExists) {
uniqueCode = generateReferralCode();
codeExists = await User.findOne({ referralCode: uniqueCode });
}
let referrer = null;
if (referralCode) {
referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
if (!referrer) {
return res.status(400).json({ message: 'Invalid referral code' });
}
}
const newUser = new User({
  mobile,
password,
wallet: 0,
bonus: 50,
deposited: false,
depositAmount: 0,
totalWagered: 0,
referralCode: uniqueCode,
referredBy: referrer ? referrer.referralCode : null 
});
  await newUser.save();
if (referrer) {
referrer.totalReferrals += 1;
await referrer.save();
}
const token = jwt.sign({ mobile }, process.env.JWT_SECRET, { expiresIn: '30d' });
console.log(`✅ New user registered: ${mobile} (Referral: ${uniqueCode})`);
res.status(201).json({
message: 'Registration successful',
token,
user: {
mobile: newUser.mobile,
wallet: newUser.wallet,
bonus: newUser.bonus,
referralCode: newUser.referralCode
}
});
} catch (err) {
console.error('Registration error:', err);
res.status(500).json({ message: 'Server error during registration' });
}
});
app.post("/login", async (req, res) => {
try {
let { mobile, password } = req.body;
if (!mobile || !password) {
return res.status(400).json({ error: "Mobile and password required" });
}
mobile = String(mobile).trim();
const user = await User.findOne({ mobile });
if (!user || user.password !== password) {
return res.status(401).json({ error: "Invalid credentials" });
}
const token = jwt.sign(
{ mobile: user.mobile },
process.env.JWT_SECRET,
{ expiresIn: '30d' }
);
res.json({
token,
wallet: user.wallet,
bonus: user.bonus
});
} catch (err) {
console.error("LOGIN ERROR:", err);
res.status(500).json({ error: "Server error" });
}
});
/* ========================= USER DATA
========================= */
app.get("/wallet", auth, async (req, res) => {
try {
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) {
return res.status(404).json({ message: 'User not found' });
}
res.json({
wallet: parseFloat(user.wallet || 0).toFixed(2),
bonus: parseFloat(user.bonus || 0).toFixed(2),
totalWagered: parseFloat(user.totalWagered || 0).toFixed(2),
deposited: user.deposited || false,
depositAmount: parseFloat(user.depositAmount || 0).toFixed(2)
});
} catch (err) {
console.error('Wallet fetch error:', err);
res.status(500).json({ message: 'Error fetching wallet data' });
}
});
app.get("/profile", auth, async (req, res) => {
try {
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) {
return res.status(404).json({ error: "User not found" });
}
res.json({
mobile: user.mobile,
wallet: user.wallet,
bonus: user.bonus,
totalWagered: user.totalWagered,
referralCode: user.referralCode,
deposited: user.deposited
});
} catch (err) {
console.error("Profile error:", err);
res.status(500).json({ error: "Server error" });
}
});
/* =========================
BETS
========================= */
app.get("/bets", auth, async (req, res) => {
try {
const bets = await Bet.find({ mobile: req.user.mobile })
.sort({ createdAt: -1 })
.limit(50);
res.json(bets);
} catch (err) {
console.error("Bets fetch error:", err);
res.status(500).json({ error: "Failed to load bets" });
}
});

app.get("/bets/current", auth, async (req, res) => {
  try {
    const bets = await Bet.find({
      mobile: req.user.mobile,
roundId: CURRENT_ROUND.id
});
res.json({ roundId: CURRENT_ROUND.id, bets });
} catch (err) {
console.error("Current bets error:", err);
res.status(500).json({ error: "Failed to load current bets" });
}
});

app.get('/round/timer', async (req, res) => {
const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
res.json({ elapsed, roundId: CURRENT_ROUND.id });
});

app.get('/rounds/history', async (req, res) => {
try {
const rounds = await Round.find({ winner: { $ne: null } })
.sort({ createdAt: -1 })
.limit(20)
.select('roundId winner redPool greenPool createdAt')
.lean();
res.json(rounds);
} catch (err) {
console.error("Rounds history error:", err);
res.status(500).json({ error: "Failed to load rounds" });
}
});

app.post("/bet", auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { color, amount: betAmount } = req.body;
    
    if (!color || !betAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Color and amount required" });
    }

    if (!['red', 'green'].includes(color.toLowerCase())) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Invalid color. Must be 'red' or 'green'" });
    }

    if (betAmount < 10 || betAmount > 10000) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Bet must be between ₹10 and ₹10,000" });
    }

    const user = await User.findOne({ mobile: req.user.mobile }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "User not found" });
    }

  if (user.banned) {
  await session.abortTransaction();
  session.endSession();
  return res.status(403).json({ error: "Account suspended. Contact support." });
}

// ✅ FIX #1: CHECK IF USER HAS DEPOSITED
if (!user.deposited) {
  await session.abortTransaction();
  session.endSession();
  return res.status(403).json({ 
    error: "First deposit required to start playing",
    requireDeposit: true 
  });
}
    const totalBalance = user.wallet + user.bonus;
    if (totalBalance < betAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Insufficient balance" });
    }

    let walletUsed = 0;
    let bonusUsed = 0;

    if (user.wallet >= betAmount) {
      walletUsed = betAmount;
    } else {
      walletUsed = user.wallet;
      bonusUsed = betAmount - user.wallet;
    }

    user.wallet = Math.round((user.wallet - walletUsed) * 100) / 100;
    user.bonus = Math.round((user.bonus - bonusUsed) * 100) / 100;
    user.totalWagered = Math.round((user.totalWagered + betAmount) * 100) / 100;
    await user.save({ session });

    await Bet.create([{
      mobile: user.mobile,
      roundId: CURRENT_ROUND.id,
      color: color.toLowerCase(),
      amount: betAmount,
      status: 'PENDING'
    }], { session });
    
    const updateField = color.toLowerCase() === 'red' ? 'redPool' : 'greenPool';
    let round = await Round.findOne({ roundId: CURRENT_ROUND.id }).session(session);
    
    if (!round) {
      console.log(`⚠️ Round ${CURRENT_ROUND.id} not found - Creating it now!`);
      const created = await Round.create([{
        roundId: CURRENT_ROUND.id,
        redPool: 0,
        greenPool: 0,
        winner: null
      }], { session });
      round = created[0];
    }
    
    if (updateField === 'redPool') {
      round.redPool = Math.round((round.redPool + betAmount) * 100) / 100;
    } else {
      round.greenPool = Math.round((round.greenPool + betAmount) * 100) / 100;
    }
    
    await round.save({ session });
    
    console.log(`🎰 Bet: ${req.user.mobile.substring(0,4)}**** - ₹${betAmount} on ${color.toUpperCase()}`);
    
    await session.commitTransaction();
    session.endSession();
    
    res.json({
      message: "Bet placed successfully",
      roundId: CURRENT_ROUND.id,
      betAmount: betAmount,
      color: color.toLowerCase(),
      newWallet: user.wallet,
      newBonus: user.bonus
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("BET ERROR:", err);
    res.status(500).json({ error: "Bet failed. Please try again." });
  }
});

/* =========================
ROUND END PROCESSING
========================= */
async function processRoundEnd(roundId) {
  console.log(`\n🎰 START PROCESSING ROUND: ${roundId}`);
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();
    console.log('✓ Transaction started');
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎰 PROCESSING ROUND: ${roundId}`);
    console.log(`${'='.repeat(50)}`);
    
    const round = await Round.findOne({ roundId }).session(session);
    
    if (!round) {
      console.error('🎰 CRITICAL: Round not found:', roundId);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    console.log('✓ Round found in database');
    
    if (round.winner !== null) {
      console.log('🎰 Round already processed with winner:', round.winner);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    const redPool = round.redPool || 0;
    const greenPool = round.greenPool || 0;
    const totalPool = redPool + greenPool;
    
    console.log(`🎰 RED POOL: ₹${redPool}`);
    console.log(`🎰 GREEN POOL: ₹${greenPool}`);
    console.log(`🎰 TOTAL POOL: ₹${totalPool}`);
    
    let winner;
    if (totalPool === 0) {
      winner = Math.random() < 0.5 ? 'red' : 'green';
      console.log('🎰 No bets - Random winner selected');
    } else if (redPool === greenPool) {
      winner = Math.random() < 0.5 ? 'red' : 'green';
      console.log('🎰 Equal pools - Random winner selected');
    } else {
      winner = redPool < greenPool ? 'red' : 'green';
      console.log('🎰 Different pools - Smaller pool wins');
    }
    
    console.log(`🎰 WINNER SELECTED: ${winner.toUpperCase()}`);
    
    round.winner = winner;
    await round.save({ session });
    
    const verifyRound = await Round.findOne({ roundId }).session(session);
    console.log('✓ Verified round in DB:', {
      roundId: verifyRound.roundId,
      winner: verifyRound.winner,
      redPool: verifyRound.redPool,
      greenPool: verifyRound.greenPool
    });
    
    if (!verifyRound.winner) {
      console.error('🎰 CRITICAL: Winner not saved to database!');
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    console.log('✓ Winner saved successfully');
    
    const bets = await Bet.find({
      roundId,
      status: 'PENDING'
    }).session(session);
    
    console.log(`🎰 Found ${bets.length} pending bets to process`);
    
    if (bets.length === 0) {
      console.log('✓ No bets to process - Committing transaction...');
      await session.commitTransaction();
      session.endSession();
      console.log(`🎰 Round ${roundId} completed with winner: ${winner.toUpperCase()}\n`);
      return;
    }
    
    let totalPayouts = 0;
    let totalLosses = 0;
    let processedCount = 0;
    
    for (const bet of bets) {
      const user = await User.findOne({ mobile: bet.mobile }).session(session);
      
      if (!user) {
        console.log(`🎰 User not found: ${bet.mobile}`);
        continue;
      }
      
      if (bet.color === winner) {
        const winAmount = Math.round(bet.amount * 2 * 0.98 * 100) / 100;
        user.wallet = Math.round((user.wallet + winAmount) * 100) / 100;
        bet.status = 'WON';
        bet.winAmount = winAmount;
        totalPayouts += winAmount;
        console.log(`🎰 ${user.mobile.substring(0, 4)}**** WON ₹${winAmount}`);
      } else {
        bet.status = 'LOST';
        bet.winAmount = 0;
        totalLosses += bet.amount;
        console.log(`🎰 ${user.mobile.substring(0, 4)}**** LOST ₹${bet.amount}`);
      }
      
      await user.save({ session });
      await bet.save({ session });
      processedCount++;
    }
    
    const houseProfit = totalLosses - totalPayouts;
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎰 Processed ${processedCount}/${bets.length} bets`);
    console.log(`🎰 Total Payouts: ₹${totalPayouts.toFixed(2)}`);
    console.log(`🎰 Total Losses: ₹${totalLosses.toFixed(2)}`);
    console.log(`🎰 House Profit: ₹${houseProfit.toFixed(2)}`);
    console.log(`${'='.repeat(50)}\n`);
    
    await session.commitTransaction();
    console.log('✓ Transaction committed successfully');
    session.endSession();
    console.log(`🎰 Round ${roundId} FULLY PROCESSED - Winner: ${winner.toUpperCase()}\n`);
    
  } catch (err) {
    console.error('\n🎰 CRITICAL ERROR IN ROUND PROCESSING');
    console.error('Error details:', err);
    await session.abortTransaction();
    session.endSession();
    console.error('🎰 Transaction aborted due to error\n');
  }
}
/* =========================
ROUND TIMER
========================= */
let roundTimer;

async function startNewRound() {
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  
  if (elapsed >= 60 && CURRENT_ROUND.id) {
    console.log(`🔒 Closing Round ID: ${CURRENT_ROUND.id}`);
    clearInterval(roundTimer);
    const oldRoundId = CURRENT_ROUND.id;
    
    await processRoundEnd(oldRoundId);
    
    const nextRoundId = await getNextRoundId();
    CURRENT_ROUND = {
      id: nextRoundId,
      startTime: Date.now()
    };
    
    console.log(`✅ Started NEW Round ID: ${CURRENT_ROUND.id}\n`);
    roundTimer = setInterval(startNewRound, 1000);
  }
}

(async () => {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const latestRound = await Round.findOne().sort({ createdAt: -1 });
    
    if (latestRound && latestRound.roundId) {
      const roundAge = Date.now() - latestRound.createdAt.getTime();
      
      if (latestRound.winner === null && roundAge < 65000) {
        const firstRoundId = latestRound.roundId;
        console.log(`♻️ RESUMING ROUND: ${firstRoundId} (Age: ${Math.floor(roundAge/1000)}s)`);
        
        CURRENT_ROUND.id = firstRoundId;
        CURRENT_ROUND.startTime = latestRound.createdAt.getTime();
      } else {
        const firstRoundId = await getNextRoundId();
        console.log(`🆕 STARTING FRESH ROUND: ${firstRoundId}`);
        
        CURRENT_ROUND.id = firstRoundId;
        CURRENT_ROUND.startTime = Date.now();
      }
    } else {
      const firstRoundId = await getNextRoundId();
      console.log(`🆕 FIRST EVER ROUND: ${firstRoundId}`);
      
      CURRENT_ROUND.id = firstRoundId;
      CURRENT_ROUND.startTime = Date.now();
    }
    
    console.log(`🚀 Round Timer Started - Round ID: ${CURRENT_ROUND.id}`);
    roundTimer = setInterval(startNewRound, 1000);
  } catch (err) {
    console.error('ROUND INIT ERROR:', err);
    
    // ✅ FIX #4: Use sequential ID even on error
    const fallbackId = await getNextRoundId();
    CURRENT_ROUND.id = fallbackId;
    CURRENT_ROUND.startTime = Date.now();
    roundTimer = setInterval(startNewRound, 1000);
  }

})();
/* =========================
WITHDRAWALS
========================= */
app.post("/wallet/withdraw", auth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount) || Number(amount) < 100) {
      return res.status(400).json({ error: "Minimum withdrawal is ₹100" });
    }

    const finalAmount = Number(amount);

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.wallet < finalAmount) {
      return res.status(400).json({ error: "Insufficient wallet balance" });
    }

    if (!user.withdrawMethod || !user.withdrawDetails) {
      return res.status(400).json({ error: "Please add withdrawal method first" });
    }

    user.wallet = Math.round((user.wallet - finalAmount) * 100) / 100;
    await user.save();

    const withdrawal = await Withdraw.create({
      mobile: user.mobile,
      amount: finalAmount,
      method: user.withdrawMethod,
      details: user.withdrawDetails,
      status: "PENDING"
    });

    console.log(`📤 Withdrawal request: ${user.mobile} - ₹${finalAmount}`);

    res.json({
      message: "Withdrawal request submitted",
      withdrawal: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        method: withdrawal.method
      },
      newWallet: user.wallet
    });

  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "Withdrawal failed" });
  }
});

app.get("/wallet/withdraw-history", auth, async (req, res) => {
  try {
    const withdrawals = await Withdraw.find({ mobile: req.user.mobile })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(withdrawals);
  } catch (err) {
    console.error("Withdraw history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/withdraw/method', auth, async (req, res) => {
  try {
    const { method, details } = req.body;

    if (!method || !details) {
      return res.status(400).json({ message: 'Method and details required' });
    }

    if (!['upi', 'bank', 'usdt'].includes(method)) {
      return res.status(400).json({ message: 'Invalid withdrawal method' });
    }

if (method === 'upi') {
      if (!details.upiId || !/^[\w.-]+@[\w.-]+$/.test(details.upiId)) {
        return res.status(400).json({ message: 'Invalid UPI ID format' });
      }
    } else if (method === 'bank') {
      if (!details.accountNumber || !details.ifsc || !details.accountHolder) {
        return res.status(400).json({ message: 'Bank details incomplete' });
      }
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.withdrawMethod = method;
    user.withdrawDetails = details;
    await user.save();

    console.log(`✅ Withdrawal method saved: ${user.mobile} - ${method}`);

    res.json({
      message: 'Withdrawal method saved successfully',
      method: user.withdrawMethod,
      details: user.withdrawDetails
    });
  } catch (err) {
    console.error('Save withdraw method error:', err);
    res.status(500).json({ message: 'Error saving withdrawal method' });
  }
});

app.get('/withdraw/method', auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      method: user.withdrawMethod,
      details: user.withdrawDetails
    });
  } catch (err) {
    console.error('Get withdraw method error:', err);
    res.status(500).json({ message: 'Error fetching withdrawal method' });
  }
});

/* =========================
WALLET HISTORY
========================= */
app.get("/wallet/history", auth, async (req, res) => {
  try {
    const deposits = await Deposit.find({ mobile: req.user.mobile })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const withdrawals = await Withdraw.find({ mobile: req.user.mobile })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const history = [
      ...deposits.map(d => ({ ...d, type: 'deposit' })),
      ...withdrawals.map(w => ({ ...w, type: 'withdraw' }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);

    res.json(history);
  } catch (err) {
    console.error("Wallet history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
REFERRAL SYSTEM
========================= */
app.get("/referral/info", auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const directReferrals = await User.find({ referredBy: user.referralCode });

    const getAllReferrals = async (referralCode, level = 1, allRefs = []) => {
      if (level > 6) return allRefs;

      const refs = await User.find({ referredBy: referralCode })
        .select('mobile referralCode depositAmount totalWagered createdAt deposited');

      for (const ref of refs) {
        allRefs.push({
          mobile: ref.mobile,
          level,
          depositAmount: ref.depositAmount || 0,
          totalWagered: ref.totalWagered || 0,
          deposited: ref.deposited || false,
          joinedAt: ref.createdAt
        });

        await getAllReferrals(ref.referralCode, level + 1, allRefs);
      }

      return allRefs;
    };

    const allReferrals = await getAllReferrals(user.referralCode);

    const commissions = await Referral.find({ userId: user.mobile })
      .sort({ createdAt: -1 })
      .limit(50);

    const levelBreakdown = {
      level1: { count: 0, earnings: 0 },
      level2: { count: 0, earnings: 0 },
      level3: { count: 0, earnings: 0 },
      level4: { count: 0, earnings: 0 },
      level5: { count: 0, earnings: 0 },
      level6: { count: 0, earnings: 0 }
    };

    allReferrals.forEach(ref => {
      levelBreakdown[`level${ref.level}`].count += 1;
    });

    commissions.forEach(comm => {
      levelBreakdown[`level${comm.level}`].earnings += comm.commission;
    });

    return res.json({
      referralCode: user.referralCode,
      totalReferrals: user.totalReferrals || directReferrals.length,
      totalEarnings: user.referralEarnings || 0,
      directReferrals: directReferrals.length,
      allTeamMembers: allReferrals.length,
      teamMembers: allReferrals,
      commissions: commissions,
      levelBreakdown: levelBreakdown
    });
  } catch (err) {
    console.error('Referral info error:', err);
    return res.status(500).json({ message: 'Error fetching referral data' });
  }
});
      /* =========================
ADMIN LOGIN
========================= */
app.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const ADMIN_USERNAME = "admin";
    const ADMIN_PASSWORD = "admin123";

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { username: ADMIN_USERNAME, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log(`✅ Admin login successful: ${ADMIN_USERNAME}`);

    res.json({
      token,
      admin: {
        username: ADMIN_USERNAME,
        role: "admin"
      }
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
ADMIN ROUTES
========================= */
app.get("/admin/users", adminAuth, async (req, res) => {
  try {
    const users = await User.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .select('-password');
    res.json(users);
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/deposits", adminAuth, async (req, res) => {
  try {
    const deposits = await Deposit.find()
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(deposits);
  } catch (err) {
    console.error("Admin deposits error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ FIX #5: ENHANCED WITHDRAWALS ENDPOINT WITH USER DETAILS
app.get("/admin/withdraws", adminAuth, async (req, res) => {
  try {
    const withdrawals = await Withdraw.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    
    // Fetch user details for each withdrawal
    const enrichedWithdrawals = await Promise.all(
      withdrawals.map(async (w) => {
        const user = await User.findOne({ mobile: w.mobile }).select('withdrawMethod withdrawDetails').lean();
        return {
          ...w,
          userWithdrawMethod: user?.withdrawMethod || null,
          userWithdrawDetails: user?.withdrawDetails || null
        };
      })
    );
    
    res.json(enrichedWithdrawals);
  } catch (err) {
    console.error("Admin withdraws error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/admin/withdraw/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, adminNote } = req.body;

    const withdrawal = await Withdraw.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ error: "Withdrawal not found" });
    }

    if (withdrawal.status !== "PENDING") {
      return res.status(400).json({ error: "Withdrawal already processed" });
    }

    const user = await User.findOne({ mobile: withdrawal.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (action === "approve") {
      withdrawal.status = "APPROVED";
      withdrawal.adminNote = adminNote || "Approved";
      withdrawal.processedAt = new Date();
    } else if (action === "reject") {
      withdrawal.status = "REJECTED";
      withdrawal.adminNote = adminNote || "Rejected";
      user.wallet = Math.round((user.wallet + withdrawal.amount) * 100) / 100;
      await user.save();
    }

    await withdrawal.save();

    console.log(`✅ Admin ${action}d withdrawal: ${withdrawal.mobile} - ₹${withdrawal.amount}`);

    res.json({
      message: `Withdrawal ${action}d successfully`,
      withdrawal
    });
  } catch (err) {
    console.error("Admin withdraw action error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
ENHANCED ADMIN ENDPOINTS
========================= */
app.get("/admin/dashboard-stats", adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const totalUsers = await User.countDocuments();
    const newUsersThisWeek = await User.countDocuments({
      createdAt: { $gte: lastWeek }
    });

    const totalDeposits = await Deposit.aggregate([
      { $match: { status: "SUCCESS" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const depositsThisWeek = await Deposit.aggregate([
      { $match: { status: "SUCCESS", createdAt: { $gte: lastWeek } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const totalWithdrawals = await Withdraw.aggregate([
      { $match: { status: "APPROVED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const pendingDeposits = await Deposit.countDocuments({ status: "PENDING" });
    const pendingWithdrawals = await Withdraw.countDocuments({ status: "PENDING" });

    const totalRevenue = totalDeposits[0]?.total || 0;
    const totalPayout = totalWithdrawals[0]?.total || 0;
    const netProfit = totalRevenue - totalPayout;

    res.json({
      totalUsers,
      newUsersThisWeek,
      totalRevenue,
      revenueThisWeek: depositsThisWeek[0]?.total || 0,
      netProfit,
      pendingActions: pendingDeposits + pendingWithdrawals,
      pendingDeposits,
      pendingWithdrawals
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/live-activity", adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const recentBets = await Bet.find()
      .sort({ createdAt: -1 })
      .limit(limit / 2)
      .select('mobile roundId color amount status winAmount createdAt');

    const recentDeposits = await Deposit.find()
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .select('mobile amount status createdAt');

    const recentWithdrawals = await Withdraw.find()
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .select('mobile amount status createdAt');

    res.json({
      bets: recentBets,
      deposits: recentDeposits,
      withdrawals: recentWithdrawals
    });
  } catch (err) {
    console.error("Live activity error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/admin/user/:mobile/ban", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { banned } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.banned = banned === true;
    await user.save();

    console.log(`✅ Admin ${banned ? 'banned' : 'unbanned'} user: ${mobile}`);

    res.json({
      message: `User ${banned ? 'banned' : 'unbanned'} successfully`,
      user: {
        mobile: user.mobile,
        banned: user.banned
      }
    });
  } catch (err) {
    console.error("Admin ban user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/admin/user/:mobile/adjust-wallet", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { amount, type } = req.body;

    if (!amount || !type || !['add', 'subtract'].includes(type)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const adjustAmount = parseFloat(amount);
    if (type === 'add') {
      user.wallet = Math.round((user.wallet + adjustAmount) * 100) / 100;
    } else {
      user.wallet = Math.max(0, Math.round((user.wallet - adjustAmount) * 100) / 100);
    }

    await user.save();

    console.log(`✅ Admin adjusted wallet for ${mobile}: ${type} ₹${adjustAmount}`);

    res.json({
      message: "Wallet adjusted successfully",
      newWallet: user.wallet
    });
  } catch (err) {
    console.error("Admin adjust wallet error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
✅ RAHUL MODI GAME ENDPOINTS
========================= */

// Get current Rahul Modi round
app.get("/rahulmodi/round/current", async (req, res) => {
  try {
    const elapsed = Math.floor((Date.now() - RAHUL_MODI_ROUND.startTime) / 1000);
    const timeLeft = Math.max(0, 60 - elapsed);
    
    res.json({
      id: RAHUL_MODI_ROUND.id,
      startTime: RAHUL_MODI_ROUND.startTime,
      timeLeft: timeLeft
    });
  } catch (err) {
    console.error("Rahul Modi current round error:", err);
    res.status(500).json({ error: "Failed to get current round" });
  }
});

// Place Rahul Modi bet
app.post("/rahulmodi/bet", auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { option, amount: betAmount } = req.body;
    
    if (!option || !betAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Option and amount required" });
    }

    if (!['rahul', 'modi'].includes(option.toLowerCase())) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Invalid option. Must be 'rahul' or 'modi'" });
    }

    if (betAmount < 10 || betAmount > 10000) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Bet must be between ₹10 and ₹10,000" });
    }

    const user = await User.findOne({ mobile: req.user.mobile }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "User not found" });
    }

   if (user.banned) {
  await session.abortTransaction();
  session.endSession();
  return res.status(403).json({ error: "Account suspended. Contact support." });
}

// ✅ FIX #1: CHECK IF USER HAS DEPOSITED (Rahul Modi game too)
if (!user.deposited) {
  await session.abortTransaction();
  session.endSession();
  return res.status(403).json({ 
    error: "First deposit required to start playing",
    requireDeposit: true 
  });
}

    const totalBalance = user.wallet + user.bonus;
    if (totalBalance < betAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Insufficient balance" });
    }

    let walletUsed = 0;
    let bonusUsed = 0;

    if (user.wallet >= betAmount) {
      walletUsed = betAmount;
    } else {
      walletUsed = user.wallet;
      bonusUsed = betAmount - user.wallet;
    }

    user.wallet = Math.round((user.wallet - walletUsed) * 100) / 100;
    user.bonus = Math.round((user.bonus - bonusUsed) * 100) / 100;
    user.totalWagered = Math.round((user.totalWagered + betAmount) * 100) / 100;
    await user.save({ session });

    await RahulModiBet.create([{
      mobile: user.mobile,
      roundId: RAHUL_MODI_ROUND.id,
      option: option.toLowerCase(),
      amount: betAmount,
      status: 'PENDING'
    }], { session });
    
    const updateField = option.toLowerCase() === 'rahul' ? 'rahulPool' : 'modiPool';
    let round = await RahulModiRound.findOne({ roundId: RAHUL_MODI_ROUND.id }).session(session);
    
    if (!round) {
      console.log(`🎮 Rahul Modi Round ${RAHUL_MODI_ROUND.id} not found - Creating it now!`);
      const created = await RahulModiRound.create([{
        roundId: RAHUL_MODI_ROUND.id,
        rahulPool: 0,
        modiPool: 0,
        winner: null
      }], { session });
      round = created[0];
    }
    
    if (updateField === 'rahulPool') {
      round.rahulPool = Math.round((round.rahulPool + betAmount) * 100) / 100;
    } else {
      round.modiPool = Math.round((round.modiPool + betAmount) * 100) / 100;
    }
    
    await round.save({ session });
    
    console.log(`🎮 Rahul Modi Bet: ${req.user.mobile.substring(0,4)}**** - ₹${betAmount} on ${option.toUpperCase()}`);
    
    await session.commitTransaction();
    session.endSession();
    
    res.json({
      message: "Bet placed successfully",
      roundId: RAHUL_MODI_ROUND.id,
      betAmount: betAmount,
      option: option.toLowerCase(),
      newWallet: user.wallet,
      newBonus: user.bonus
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("🎮 RAHUL MODI BET ERROR:", err);
    res.status(500).json({ error: "Bet failed. Please try again." });
  }
});

// Get Rahul Modi Round History
app.get("/rahulmodi/rounds/history", async (req, res) => {
  try {
    const rounds = await RahulModiRound.find({ winner: { $ne: null } })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("roundId winner rahulPool modiPool createdAt")
      .lean();
    
    console.log(`🎮 Returning ${rounds.length} Rahul Modi completed rounds`);
    
    res.json(rounds);
  } catch (err) {
    console.error("Rahul Modi rounds history error:", err);
    res.status(500).json({ error: "Failed to load rounds" });
  }
});

// Get Rahul Modi Bets
app.get("/rahulmodi/bets", auth, async (req, res) => {
  try {
    const bets = await RahulModiBet.find({ mobile: req.user.mobile })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(bets);
  } catch (err) {
    console.error("Rahul Modi bets fetch error:", err);
    res.status(500).json({ error: "Failed to load bets" });
  }
});

// Get Current Round Bets
app.get("/rahulmodi/bets/current", auth, async (req, res) => {
  try {
    const bets = await RahulModiBet.find({
      mobile: req.user.mobile,
      roundId: RAHUL_MODI_ROUND.id
    });
    res.json({ roundId: RAHUL_MODI_ROUND.id, bets });
  } catch (err) {
    console.error("Rahul Modi current bets error:", err);
    res.status(500).json({ error: "Failed to load current bets" });
  }
});

/* =========================
RAHUL MODI ROUND PROCESSING
========================= */
async function processRahulModiRoundEnd(roundId) {
  console.log(`\n🎮 START PROCESSING RAHUL MODI ROUND: ${roundId}`);
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();
    console.log('✓ Transaction started');
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎮 PROCESSING RAHUL MODI ROUND: ${roundId}`);
    console.log(`${'='.repeat(50)}`);
    
    const round = await RahulModiRound.findOne({ roundId }).session(session);
    
    if (!round) {
      console.error('🎮 CRITICAL: Rahul Modi Round not found:', roundId);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    console.log('✓ Round found in database');
    
    if (round.winner !== null) {
      console.log('🎮 Round already processed with winner:', round.winner);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    const rahulPool = round.rahulPool || 0;
    const modiPool = round.modiPool || 0;
    const totalPool = rahulPool + modiPool;
    
    console.log(`🎮 RAHUL POOL: ₹${rahulPool}`);
    console.log(`🎮 MODI POOL: ₹${modiPool}`);
    console.log(`🎮 TOTAL POOL: ₹${totalPool}`);
    
    let winner;
    if (totalPool === 0) {
      winner = Math.random() < 0.5 ? 'rahul' : 'modi';
      console.log('🎮 No bets - Random winner selected');
    } else if (rahulPool === modiPool) {
      winner = Math.random() < 0.5 ? 'rahul' : 'modi';
      console.log('🎮 Equal pools - Random winner selected');
    } else {
      winner = rahulPool < modiPool ? 'rahul' : 'modi';
      console.log('🎮 Different pools - Smaller pool wins');
    }
    
    console.log(`🎮 WINNER SELECTED: ${winner.toUpperCase()}`);
    
    round.winner = winner;
    await round.save({ session });
    
    const verifyRound = await RahulModiRound.findOne({ roundId }).session(session);
    console.log('✓ Verified round in DB:', {
      roundId: verifyRound.roundId,
      winner: verifyRound.winner,
      rahulPool: verifyRound.rahulPool,
      modiPool: verifyRound.modiPool
    });
    
    if (!verifyRound.winner) {
      console.error('🎮 CRITICAL: Winner not saved to database!');
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    console.log('✓ Winner saved successfully');
    
    const bets = await RahulModiBet.find({
      roundId,
      status: 'PENDING'
    }).session(session);
    
    console.log(`🎮 Found ${bets.length} pending bets to process`);
    
    if (bets.length === 0) {
      console.log('✓ No bets to process - Committing transaction...');
      await session.commitTransaction();
      session.endSession();
      console.log(`🎮 Round ${roundId} completed with winner: ${winner.toUpperCase()}\n`);
      return;
    }
    
    let totalPayouts = 0;
    let totalLosses = 0;
    let processedCount = 0;
    
    for (const bet of bets) {
      const user = await User.findOne({ mobile: bet.mobile }).session(session);
      
      if (!user) {
        console.log(`🎮 User not found: ${bet.mobile}`);
        continue;
      }
      
      if (bet.option === winner) {
        const winAmount = Math.round(bet.amount * 2 * 0.98 * 100) / 100;
        user.wallet = Math.round((user.wallet + winAmount) * 100) / 100;
        bet.status = 'WON';
        bet.winAmount = winAmount;
        totalPayouts += winAmount;
        console.log(`🎮 ${user.mobile.substring(0, 4)}**** WON ₹${winAmount}`);
      } else {
        bet.status = 'LOST';
        bet.winAmount = 0;
        totalLosses += bet.amount;
        console.log(`🎮 ${user.mobile.substring(0, 4)}**** LOST ₹${bet.amount}`);
      }
      
      await user.save({ session });
      await bet.save({ session });
      processedCount++;
    }
    
    const houseProfit = totalLosses - totalPayouts;
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎮 Processed ${processedCount}/${bets.length} bets`);
    console.log(`🎮 Total Payouts: ₹${totalPayouts.toFixed(2)}`);
    console.log(`🎮 Total Losses: ₹${totalLosses.toFixed(2)}`);
    console.log(`🎮 House Profit: ₹${houseProfit.toFixed(2)}`);
    console.log(`${'='.repeat(50)}\n`);
    
    await session.commitTransaction();
    console.log('✓ Transaction committed successfully');
    session.endSession();
    console.log(`🎮 Rahul Modi Round ${roundId} FULLY PROCESSED - Winner: ${winner.toUpperCase()}\n`);
    
  } catch (err) {
    console.error('\n🎮 CRITICAL ERROR IN RAHUL MODI ROUND PROCESSING');
    console.error('Error details:', err);
    await session.abortTransaction();
    session.endSession();
    console.error('🎮 Transaction aborted due to error\n');
  }
}

/* =========================
RAHUL MODI ROUND TIMER
========================= */
let rahulModiRoundTimer;

async function startNewRahulModiRound() {
  const elapsed = Math.floor((Date.now() - RAHUL_MODI_ROUND.startTime) / 1000);
  
  if (elapsed >= 60 && RAHUL_MODI_ROUND.id) {
    console.log(`🎮 Closing Rahul Modi Round ID: ${RAHUL_MODI_ROUND.id}`);
    clearInterval(rahulModiRoundTimer);
    const oldRoundId = RAHUL_MODI_ROUND.id;
    
    await processRahulModiRoundEnd(oldRoundId);
    
    const nextRoundId = await getNextRahulModiRoundId();
    RAHUL_MODI_ROUND = {
      id: nextRoundId,
      startTime: Date.now()
    };
    
    console.log(`✅ Started NEW Rahul Modi Round ID: ${RAHUL_MODI_ROUND.id}\n`);
    rahulModiRoundTimer = setInterval(startNewRahulModiRound, 1000);
  }
}

(async () => {
  try {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const latestRound = await RahulModiRound.findOne().sort({ createdAt: -1 });
    
    if (latestRound && latestRound.roundId) {
      const roundAge = Date.now() - latestRound.createdAt.getTime();
      
      if (latestRound.winner === null && roundAge < 65000) {
        const firstRoundId = latestRound.roundId;
        console.log(`🎮 ♻️ RESUMING RAHUL MODI ROUND: ${firstRoundId} (Age: ${Math.floor(roundAge/1000)}s)`);
        
        RAHUL_MODI_ROUND.id = firstRoundId;
        RAHUL_MODI_ROUND.startTime = latestRound.createdAt.getTime();
      } else {
        const firstRoundId = await getNextRahulModiRoundId();
        console.log(`🎮 🆕 STARTING FRESH RAHUL MODI ROUND: ${firstRoundId}`);
        
        RAHUL_MODI_ROUND.id = firstRoundId;
        RAHUL_MODI_ROUND.startTime = Date.now();
      }
    } else {
      const firstRoundId = await getNextRahulModiRoundId();
      console.log(`🎮 🆕 FIRST EVER RAHUL MODI ROUND: ${firstRoundId}`);
      
      RAHUL_MODI_ROUND.id = firstRoundId;
      RAHUL_MODI_ROUND.startTime = Date.now();
    }
    
    console.log(`🎮 🚀 Rahul Modi Round Timer Started - Round ID: ${RAHUL_MODI_ROUND.id}`);
    rahulModiRoundTimer = setInterval(startNewRahulModiRound, 1000);
  } catch (err) {
    console.error('🎮 RAHUL MODI ROUND INIT ERROR:', err);
    
    RAHUL_MODI_ROUND.id = Date.now().toString();
    RAHUL_MODI_ROUND.startTime = Date.now();
    rahulModiRoundTimer = setInterval(startNewRahulModiRound, 1000);
  }
})();

/* =========================
SERVER START
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🎮 BIGWIN Backend Server');
  console.log('='.repeat(50));
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 API URL: http://localhost:${PORT}`);
  console.log(`📊 MongoDB: Connected`);
  console.log(`⏰ Round Duration: 60 seconds`);
  console.log(`🏦 House Edge: 2%`);
  console.log(`🎁 Registration Bonus: ₹50 bonus`);
  console.log(`💰 Referral Levels: 6 (11% total commission - HALVED)`);
  console.log(`✅ Referral Earnings: WAGER-FREE (added to wallet)`);
  console.log('='.repeat(50) + '\n');
});
