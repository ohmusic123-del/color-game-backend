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
const GiftCode = require("./models/GiftCode");

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

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if username exists
        const existing = await MonitorUser.findOne({ username });
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        console.log('Hashing password...');
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('Password hashed successfully');

        // Create monitor user
        const monitor = await MonitorUser.create({
            username,
            password: hashedPassword,
            displayName: displayName || username,
            createdBy: req.admin.username || 'admin'
        });

        console.log('Monitor user created:', monitor.username);

        // Log activity
        await MonitorActivity.create({
            username: req.admin.username || 'admin',
           action: `CREATED monitor user: ${username}`,

            ipAddress: req.ip
        });

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
const COMMISSION_RATES = {
  1: 0.10, // 10%
  2: 0.05, // 5%
  3: 0.03, // 3%
  4: 0.02, // 2%
  5: 0.01, // 1%
  6: 0.01  // 1%
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
      referrer.wallet = Math.round((referrer.wallet + commission) * 100) / 100;
      referrer.referralEarnings = Math.round((referrer.referralEarnings + commission) * 100) / 100;
      await referrer.save();
      
      await Referral.create({
        userId: referrer.mobile,
        referredUserId: userId,
        level,
        commission,
        type,
        amount
      });
      
      console.log(`💰 Level ${level} commission: ₹${commission} to ${referrer.mobile}`);
      
      currentReferrer = referrer.referredBy;
      level++;
    }
  } catch (err) {
    console.error("Referral commission error:", err);
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


app.get("/round/current", async (req, res) => {
  try {
    const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
    const timeLeft = Math.max(0, 60 - elapsed);
    
    // Return the current round info with timing data
    res.json({
      id: CURRENT_ROUND.id,
      roundId: CURRENT_ROUND.id,
      startTime: CURRENT_ROUND.startTime,
      timeLeft: timeLeft,
      serverTime: Date.now()
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
        user.bonus = Math.round(((user.bonus || 0) + amountToAdd) * 100) / 100;
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
      error: errorDetails,
      details: process.env.NODE_ENV === 'development' ? {
        response: err.response?.data,
        status: err.response?.status
      } : undefined
    });
  }
});

/* =========================
ALTERNATIVE: Manual Cashfree API Call (if SDK fails)
========================= */
app.post("/api/cashfree/create-order-manual", auth, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || Number(amount) < 10) {
      return res.status(400).json({ success: false, message: "Minimum deposit ₹10" });
    }
    
    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    const orderId = `ORDER_${Date.now()}_${user.mobile.slice(-4)}`;
    
    // Manual API call using fetch/axios
    const axios = require('axios');
    
    const cashfreeUrl = process.env.CASHFREE_ENV === 'SANDBOX' 
      ? 'https://sandbox.cashfree.com/pg/orders'
      : 'https://api.cashfree.com/pg/orders';
    
    const orderData = {
      order_amount: Number(amount),
      order_currency: "INR",
      order_id: orderId,
      customer_details: {
        customer_id: user.mobile,
        customer_phone: user.mobile,
        customer_email: `user${user.mobile}@bigwin.in`
      }
    };
    
    console.log('📝 Creating order via manual API call...');
    console.log('URL:', cashfreeUrl);
    console.log('Data:', orderData);
    
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

// Generate userCode if not exists
let userCode = user.userCode;
if (!userCode) {
userCode = `USER${user.mobile.slice(-6)}`;
user.userCode = userCode;
await user.save();
}

res.json({
mobile: user.mobile,
userCode: userCode,
referralCode: user.referralCode,
wallet: parseFloat(user.wallet || 0).toFixed(2),
bonus: parseFloat(user.bonus || 0).toFixed(2),
totalWagered: parseFloat(user.totalWagered || 0).toFixed(2),
deposited: user.deposited || false,
depositAmount: parseFloat(user.depositAmount || 0).toFixed(2),
createdAt: user.createdAt
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

// Generate userCode if not exists
let userCode = user.userCode;
if (!userCode) {
userCode = `USER${user.mobile.slice(-6)}`;
user.userCode = userCode;
await user.save();
}

res.json({
mobile: user.mobile,
userCode: userCode,
wallet: user.wallet || 0,
bonus: user.bonus || 0,
totalWagered: user.totalWagered || 0,
referralCode: user.referralCode,
deposited: user.deposited || 0,
createdAt: user.createdAt
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
app.get("/bets/current", auth, async (req, res) => { try {
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
/* =========================
BET ENDPOINT - FIXED
========================= */
app.post("/bet", auth, async (req, res) => {
const session = await mongoose.startSession();
try {
await session.startTransaction();
const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
if (elapsed >= 57) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Round closed for betting" });
}
const { color, amount } = req.body;
if (!color || !['red', 'green'].includes(color.toLowerCase())) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Invalid color. Choose red or green." });
}
if (!amount || amount < 1) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({ error: "Minimum bet ₹1" });
}
const betAmount = Math.round(amount * 100) / 100;
const user = await User.findOne({ mobile: req.user.mobile }).session(session);
if (!user) {
await session.abortTransaction();
session.endSession();
return res.status(404).json({ error: "User not found" });
}
   // ✅ ADD THIS CHECK - Block betting if no deposit
    if (!user.deposited) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ 
        error: "Please make your first deposit to start playing",
        requireDeposit: true 
      });
    }
    
    const existingBet = await Bet.findOne({
      mobile: req.user.mobile,
      roundId: CURRENT_ROUND.id
    }).session(session);
    
    if (existingBet) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: `Already placed bet: ₹${existingBet.amount} on ${existingBet.color.toUpperCase()}`
      });
    }

const totalBalance = (user.wallet || 0) + (user.bonus || 0);
if (totalBalance < betAmount) {
await session.abortTransaction();
session.endSession();
return res.status(400).json({
error: `Insufficient balance. Available: ₹${totalBalance.toFixed(2)}`
});
}
let deductFromBonus = Math.min(user.bonus, betAmount);
let deductFromWallet = betAmount - deductFromBonus;
user.bonus = Math.round((user.bonus - deductFromBonus) * 100) / 100;
user.wallet = Math.round((user.wallet - deductFromWallet) * 100) / 100;
user.totalWagered = Math.round(((user.totalWagered || 0) + betAmount) * 100) / 100;
await user.save({ session });
await Bet.create([{
mobile: req.user.mobile,
roundId: CURRENT_ROUND.id,
color: color.toLowerCase(),
amount: betAmount,
status: 'PENDING',
createdAt: new Date()
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
console.log(`✅ Bet: ${req.user.mobile.substring(0,4)}**** - ₹${betAmount} on ${color.toUpperCase()} | Pools: R=₹${round.redPool} G=₹${round.greenPool}`); await session.commitTransaction();
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
console.error("❌ BET ERROR:", err);
res.status(500).json({ error: "Bet failed. Please try again." });
}
});


/* =========================
FIXED ROUND PROCESSING - Replace your existing processRoundEnd function
========================= */
async function processRoundEnd(roundId) {
  console.log(`\n🔄 START PROCESSING ROUND: ${roundId}`);
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();
    console.log('✓ Transaction started');
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎯 PROCESSING ROUND: ${roundId}`);
    console.log(`${'='.repeat(50)}`);
    
    // Find the round
    const round = await Round.findOne({ roundId }).session(session);
    
    if (!round) {
      console.error('❌ CRITICAL: Round not found in database:', roundId);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    console.log('✓ Round found in database');
    
    // Check if already processed
    if (round.winner !== null) {
      console.log('⚠️ Round already processed with winner:', round.winner);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    const redPool = round.redPool || 0;
    const greenPool = round.greenPool || 0;
    const totalPool = redPool + greenPool;
    
    console.log(`💰 RED POOL: ₹${redPool}`);
    console.log(`💰 GREEN POOL: ₹${greenPool}`);
    console.log(`💰 TOTAL POOL: ₹${totalPool}`);
    
    // Determine winner
    let winner;
    if (totalPool === 0) {
      winner = Math.random() < 0.5 ? 'red' : 'green';
      console.log('🎲 No bets - Random winner selected');
    } else if (redPool === greenPool) {
      winner = Math.random() < 0.5 ? 'red' : 'green';
      console.log('🎲 Equal pools - Random winner selected');
    } else {
      winner = redPool < greenPool ? 'red' : 'green';
      console.log('⚖️ Different pools - Smaller pool wins');
    }
    
    console.log(`🏆 WINNER SELECTED: ${winner.toUpperCase()}`);
    
    // Save winner
    round.winner = winner;
    await round.save({ session });
    
    // CRITICAL: Verify the save
    const verifyRound = await Round.findOne({ roundId }).session(session);
    console.log('✓ Verified round in DB:', {
      roundId: verifyRound.roundId,
      winner: verifyRound.winner,
      redPool: verifyRound.redPool,
      greenPool: verifyRound.greenPool
    });
    
    if (!verifyRound.winner) {
      console.error('❌ CRITICAL: Winner not saved to database!');
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    console.log('✓ Winner saved successfully');
    
    // Process bets
    const bets = await Bet.find({
      roundId,
      status: 'PENDING'
    }).session(session);
    
    console.log(`📊 Found ${bets.length} pending bets to process`);
    
    if (bets.length === 0) {
      console.log('✓ No bets to process - Committing transaction...');
      await session.commitTransaction();
      session.endSession();
      console.log(`✅ Round ${roundId} completed with winner: ${winner.toUpperCase()}\n`);
      return;
    }
    
    let totalPayouts = 0;
    let totalLosses = 0;
    let processedCount = 0;
    
    for (const bet of bets) {
      const user = await User.findOne({ mobile: bet.mobile }).session(session);
      
      if (!user) {
        console.log(`⚠️ User not found: ${bet.mobile}`);
        continue;
      }
      
      if (bet.color === winner) {
        const winAmount = Math.round(bet.amount * 2 * 0.98 * 100) / 100;
        user.wallet = Math.round((user.wallet + winAmount) * 100) / 100;
        bet.status = 'WON';
        bet.winAmount = winAmount;
        totalPayouts += winAmount;
        console.log(`✅ ${user.mobile.substring(0, 4)}**** WON ₹${winAmount}`);
      } else {
        bet.status = 'LOST';
        bet.winAmount = 0;
        totalLosses += bet.amount;
        console.log(`❌ ${user.mobile.substring(0, 4)}**** LOST ₹${bet.amount}`);
      }
      
      await user.save({ session });
      await bet.save({ session });
      processedCount++;
    }
    
    const houseProfit = totalLosses - totalPayouts;
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📈 Processed ${processedCount}/${bets.length} bets`);
    console.log(`💸 Total Payouts: ₹${totalPayouts.toFixed(2)}`);
    console.log(`💰 Total Losses: ₹${totalLosses.toFixed(2)}`);
    console.log(`🏦 House Profit: ₹${houseProfit.toFixed(2)}`);
    console.log(`${'='.repeat(50)}\n`);
    
    // Commit transaction
    await session.commitTransaction();
    console.log('✓ Transaction committed successfully');
    session.endSession();
    console.log(`✅ Round ${roundId} FULLY PROCESSED - Winner: ${winner.toUpperCase()}\n`);
    
  } catch (err) {
    console.error('\n❌ CRITICAL ERROR IN ROUND PROCESSING');
    console.error('Error details:', err);
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Transaction aborted due to error\n');
  }
}

/* =========================
FIXED ROUND TIMER - Replace your existing setInterval
========================= */
setInterval(async () => {
  const elapsed = Math.floor((Date.now() - CURRENT_ROUND.startTime) / 1000);
  
  if (elapsed >= 60) {
    console.log('\n⏰ Round timer reached 60 seconds');
    console.log(`🔒 Closing Round ID: ${CURRENT_ROUND.id}`);
    
    const oldRoundId = CURRENT_ROUND.id;
    
    // Get next round ID FIRST
    const newRoundId = await getNextRoundId();
    console.log(`\n🆕 Creating new round: ${newRoundId}`);
    
    // Update current round IMMEDIATELY (before processing old round)
    CURRENT_ROUND = {
      id: newRoundId,
      startTime: Date.now()
    };
    
    try {
      // Check if round already exists (prevent duplicates)
      const existingRound = await Round.findOne({ roundId: newRoundId });
      
      if (existingRound) {
        console.log(`⚠️ Round ${newRoundId} already exists, skipping creation`);
      } else {
        // Create new round in database
        await Round.create({
          roundId: newRoundId,
          redPool: 0,
          greenPool: 0,
          winner: null
        });
        console.log('✓ New round created in database');
      }
      
      console.log('='.repeat(50));
      console.log(`🎮 NEW ROUND STARTED: ${newRoundId}`);
      console.log(`⏱️ Duration: 60 seconds`);
      console.log(`📅 Next Round: ${parseInt(newRoundId) + 1}`);
      console.log('='.repeat(50) + '\n');
      
    } catch (err) {
      console.error('❌ CRITICAL: Failed to create new round!');
      console.error('Error:', err);
    }
    
    // Process the OLD round AFTER starting new one
    processRoundEnd(oldRoundId);
  }
}, 1000);

/* =========================
FIXED ROUND INITIALIZATION - Replace your existing initialization
========================= */
(async () => {
  try {
    console.log('\n🚀 Initializing game server...');
    
    // Check for any open rounds
    const openRound = await Round.findOne({ winner: null }).sort({ createdAt: -1 });
    
    let firstRoundId;
    
    if (openRound) {
      // Resume existing round
      firstRoundId = openRound.roundId;
      console.log(`♻️ Resuming round: ${firstRoundId}`);
    } else {
      // Create new round
      firstRoundId = await getNextRoundId();
      await Round.create({
        roundId: firstRoundId,
        redPool: 0,
        greenPool: 0,
        winner: null
      });
      console.log(`✓ Round ${firstRoundId} created`);
    }
    
    // Set current round
    CURRENT_ROUND.id = firstRoundId;
    CURRENT_ROUND.startTime = Date.now();
    
    console.log('✅ Game server ready!\n');
    console.log('='.repeat(50));
    console.log(`🎮 Current Round: ${firstRoundId}`);
    console.log(`⏱️ Round Duration: 60 seconds`);
    console.log(`📅 Next Round: ${parseInt(firstRoundId) + 1}`);
    console.log('='.repeat(50) + '\n');
    
  } catch (err) {
    console.error('❌ Round initialization error:', err);
    // Fallback to timestamp if sequential fails
    CURRENT_ROUND.id = Date.now().toString();
    CURRENT_ROUND.startTime = Date.now();
  }
})();


/* =========================
ROUND INFO
========================= */
app.get("/rounds/history", async (req, res) => {
    try {
        // ✅ ONLY return rounds that have a winner (completed rounds)
        const rounds = await Round.find({ winner: { $ne: null } })
            .sort({ createdAt: -1 })
            .limit(20)
            .select("roundId winner redPool greenPool createdAt")
            .lean();
        
        console.log(`📊 Returning ${rounds.length} completed rounds`);
        
        res.json(rounds);
    } catch (err) {
        console.error("Rounds history error:", err);
        res.status(500).json({ error: "Failed to load rounds" });
    }
});
/* =========================
DEPOSIT
========================= */
app.post("/deposit", auth, async (req, res) => {
try {
const { amount, referenceId } = req.body;
if (!amount || amount < 100) {
return res.status(400).json({ error: "Minimum deposit ₹100" });
}
const user = await User.findOne({ mobile: req.user.mobile });
if (!user) {
return res.status(404).json({ error: "User not found" });
}
const deposit = await Deposit.create({
mobile: user.mobile,
amount,
method: "upi",
referenceId: referenceId || "AUTO",
status: "SUCCESS"
});
user.wallet = Math.round((user.wallet + amount) * 100) / 100;
user.deposited = true;
user.depositAmount = Math.round((user.depositAmount + amount) * 100) / 100;
const isFirstDeposit = user.depositAmount === amount;
if (isFirstDeposit) {
// 20% bonus on first deposit
const bonusAmount = Math.round((amount * 0.20) * 100) / 100;
user.bonus = Math.round((user.bonus + bonusAmount) * 100) / 100;
console.log(`🎁 First deposit bonus applied: ₹${bonusAmount} (20% of ₹${amount})`);
}
await user.save();
await processReferralCommission(user.mobile, amount, "DEPOSIT");
console.log(`✅ Deposit: ${user.mobile} - ₹${amount} (First: ${isFirstDeposit})`);

res.json({
message: "Deposit successful",
newWallet: user.wallet,
newBonus: user.bonus,
deposit
});
} catch (err) {
console.error("Deposit error:", err);
res.status(500).json({ error: "Deposit failed" });
}
});

app.get("/wallet/deposit-history", auth, async (req, res) => {
try {
const deposits = await Deposit.find({ mobile: req.user.mobile })
.sort({ createdAt: -1 })
.limit(20);
res.json(deposits);
} catch (err) {
console.error("Deposit history error:", err);
res.status(500).json({ error: "Server error" });
}
});
/* =========================
WITHDRAWAL - FIXED
========================= */
app.post("/withdraw", auth, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Minimum withdrawal ₹100" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user has set withdrawal method
    if (!user.withdrawMethod || !user.withdrawDetails) {
      return res.status(400).json({ 
        error: "Please set withdrawal method first" 
      });
    }

    // Check if user has sufficient balance
    if (user.wallet < amount) {
      return res.status(400).json({ 
        error: `Insufficient balance. Available: ₹${user.wallet.toFixed(2)}` 
      });
    }

    // Check if user has made a deposit
    if (!user.deposited) {
      return res.status(400).json({ 
        error: "You must make a deposit before withdrawing" 
      });
    }

    // Deduct amount from wallet
    user.wallet = Math.round((user.wallet - amount) * 100) / 100;
    await user.save();

    // Create withdrawal request
    const withdrawal = await Withdraw.create({
      mobile: user.mobile,
      amount: amount,
      method: user.withdrawMethod,
      details: user.withdrawDetails,
      status: "PENDING"
    });

    console.log(`✅ Withdrawal request: ${user.mobile} - ₹${amount} (${user.withdrawMethod})`);

    res.json({
      message: "Withdrawal request submitted successfully",
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

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      const token = jwt.sign(
        { username: username, role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log('✅ Admin logged in:', username);

      return res.json({
        message: "Admin login successful",
        token: `Bearer ${token}`
      });
    } else {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: "Server error" });
  }
});
/* =========================
ADMIN ENDPOINTS
========================= */
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalDeposits = await Deposit.aggregate([
      { $match: { status: "SUCCESS" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const totalWithdraws = await Withdraw.aggregate([
      { $match: { status: "APPROVED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const totalWallet = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$wallet" } } }
    ]);

    const totalRounds = await Round.countDocuments();
    const profit = (totalDeposits[0]?.total || 0) - (totalWithdraws[0]?.total || 0);

    res.json({
      totalUsers,
      totalDeposits: totalDeposits[0]?.total || 0,
      totalWithdraws: totalWithdraws[0]?.total || 0,
      totalWallet: totalWallet[0]?.total || 0,
      profit,
      totalRounds
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/users", adminAuth, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(100);
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

app.post("/admin/deposit/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, adminNote } = req.body;

    const deposit = await Deposit.findById(id);
    if (!deposit) {
      return res.status(404).json({ error: "Deposit not found" });
    }

    if (deposit.status !== "PENDING") {
      return res.status(400).json({ error: "Deposit already processed" });
    }

    const user = await User.findOne({ mobile: deposit.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (action === "approve") {
      deposit.status = "SUCCESS";
      deposit.adminNote = adminNote || "Approved";

      user.wallet = Math.round((user.wallet + deposit.amount) * 100) / 100;
      user.deposited = true;
      user.depositAmount = Math.round((user.depositAmount + deposit.amount) * 100) / 100;

      const isFirstDeposit = user.depositAmount === deposit.amount;
      if (isFirstDeposit) {
        user.bonus = Math.round((user.bonus + deposit.amount) * 100) / 100;
      }
await user.save();
      await processReferralCommission(user.mobile, deposit.amount, "DEPOSIT");
    } else if (action === "reject") {
      deposit.status = "FAILED";
      deposit.adminNote = adminNote || "Rejected";
    }

    await deposit.save();

    console.log(`✅ Admin ${action}d deposit: ${deposit.mobile} - ₹${deposit.amount}`);

    res.json({
      message: `Deposit ${action}d successfully`,
      deposit
    });
  } catch (err) {
    console.error("Admin deposit action error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/withdraws", adminAuth, async (req, res) => {
  try {
    const withdrawals = await Withdraw.find()
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(withdrawals);
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
      .lean();

    const recentDeposits = await Deposit.find()
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .lean();

    const recentWithdrawals = await Withdraw.find()
      .sort({ createdAt: -1 })
      .limit(limit / 4)
      .lean();

    const activities = [
      ...recentBets.map(b => ({
        type: 'bet',
        title: `Bet placed on ${b.color.toUpperCase()}`,
        user: b.mobile.substring(0, 4) + '****' + b.mobile.substring(8),
        amount: b.amount,
        time: b.createdAt
      })),
      ...recentDeposits.map(d => ({
        type: 'deposit',
        title: `Deposit ${d.status}`,
        user: d.mobile.substring(0, 4) + '****' + d.mobile.substring(8),
        amount: d.amount,
        time: d.createdAt
      })),
      ...recentWithdrawals.map(w => ({
        type: 'withdraw',
        title: `Withdrawal ${w.status}`,
        user: w.mobile.substring(0, 4) + '****' + w.mobile.substring(8),
        amount: w.amount,
        time: w.createdAt
      }))
    ]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, limit);

    res.json(activities);
  } catch (err) {
    console.error("Live activity error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/user-analytics", adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const depositedUsers = await User.countDocuments({ deposited: true });
    const activeUsers = await Bet.distinct('mobile', {
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    const topDepositors = await User.find()
      .sort({ depositAmount: -1 })
      .limit(10)
      .select('mobile depositAmount wallet totalWagered');

    const topWagerers = await User.find()
      .sort({ totalWagered: -1 })
      .limit(10)
      .select('mobile totalWagered depositAmount wallet');

    res.json({
      totalUsers,
      depositedUsers,
      activeUsersToday: activeUsers.length,
      conversionRate: ((depositedUsers / totalUsers) * 100).toFixed(2),
      topDepositors,
      topWagerers
    });
  } catch (err) {
    console.error("User analytics error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/admin/game-analytics", adminAuth, async (req, res) => {
  try {
    const totalBets = await Bet.countDocuments();
    const totalWagered = await Bet.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const redBets = await Bet.countDocuments({ color: 'red' });
    const greenBets = await Bet.countDocuments({ color: 'green' });
    const wonBets = await Bet.countDocuments({ status: 'WON' });
    const lostBets = await Bet.countDocuments({ status: 'LOST' });

    const totalWinnings = await Bet.aggregate([
      { $match: { status: 'WON' } },
      { $group: { _id: null, total: { $sum: "$winAmount" } } }
    ]);

    const houseEdge = totalWagered[0]?.total - (totalWinnings[0]?.total || 0);

    res.json({
      totalBets,
      totalWagered: totalWagered[0]?.total || 0,
      redBetsPercentage: ((redBets / totalBets) * 100).toFixed(2),
      greenBetsPercentage: ((greenBets / totalBets) * 100).toFixed(2),
      winRate: ((wonBets / (wonBets + lostBets)) * 100).toFixed(2),
      houseEdge: houseEdge.toFixed(2),
      totalPayouts: totalWinnings[0]?.total || 0
    });
  } catch (err) {
    console.error("Game analytics error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/admin/user/:mobile/ban", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { banned, reason } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.banned = banned;
    if (banned) {
      user.banReason = reason || "Violation of terms";
    }
    await user.save();

    console.log(`Admin ${banned ? 'banned' : 'unbanned'} user: ${mobile}`);

    res.json({
      message: `User ${banned ? 'banned' : 'unbanned'} successfully`,
      user: {
        mobile: user.mobile,
        banned: user.banned
      }
    });
  } catch (err) {
    console.error("Ban user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/admin/user/:mobile/adjust-balance", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { amount, type, reason } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (type === 'wallet') {
      user.wallet = Math.max(0, Math.round((user.wallet + amount) * 100) / 100);
    } else if (type === 'bonus') {
      user.bonus = Math.max(0, Math.round((user.bonus + amount) * 100) / 100);
    } else {
      return res.status(400).json({ error: "Invalid type" });
    }

    await user.save();

    console.log(`Admin adjusted ${type}: ${mobile} ${amount > 0 ? '+' : ''}₹${amount} - ${reason}`);

    res.json({
      message: "Balance adjusted successfully",
      newWallet: user.wallet,
      newBonus: user.bonus
    });
  } catch (err) {
    console.error("Balance adjustment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
ENHANCED ADMIN USER MANAGEMENT
========================= */

// Get detailed user information
app.get("/admin/user/:mobile", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    
    const user = await User.findOne({ mobile }).select('-password');
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get user's betting history
    const bets = await Bet.find({ mobile })
      .sort({ createdAt: -1 })
      .limit(50);

    // Get user's deposit history
    const deposits = await Deposit.find({ mobile })
      .sort({ createdAt: -1 })
      .limit(20);

    // Get user's withdrawal history
    const withdrawals = await Withdraw.find({ mobile })
      .sort({ createdAt: -1 })
      .limit(20);

    // Get referral information
    const directReferrals = await User.find({ referredBy: user.referralCode })
      .select('mobile wallet depositAmount createdAt');

    // Calculate statistics
    const totalBets = bets.length;
    const totalWagered = bets.reduce((sum, bet) => sum + bet.amount, 0);
    const totalWon = bets.filter(b => b.status === 'WON').length;
    const totalLost = bets.filter(b => b.status === 'LOST').length;
    const winRate = totalBets > 0 ? ((totalWon / totalBets) * 100).toFixed(2) : 0;

    const totalDeposited = deposits
      .filter(d => d.status === 'SUCCESS')
      .reduce((sum, d) => sum + d.amount, 0);

    const totalWithdrawn = withdrawals
      .filter(w => w.status === 'APPROVED')
      .reduce((sum, w) => sum + w.amount, 0);

    res.json({
      user,
      statistics: {
        totalBets,
        totalWagered: totalWagered.toFixed(2),
        totalWon,
        totalLost,
        winRate,
        totalDeposited: totalDeposited.toFixed(2),
        totalWithdrawn: totalWithdrawn.toFixed(2),
        netProfit: (totalDeposited - totalWithdrawn).toFixed(2),
        directReferrals: directReferrals.length
      },
      recentBets: bets.slice(0, 10),
      recentDeposits: deposits.slice(0, 5),
      recentWithdrawals: withdrawals.slice(0, 5),
      referrals: directReferrals
    });
  } catch (err) {
    console.error("Admin user details error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Search users
app.get("/admin/users/search", adminAuth, async (req, res) => {
  try {
    const { query, type } = req.query;

    let searchCriteria = {};

    if (type === 'mobile') {
      searchCriteria = { mobile: { $regex: query, $options: 'i' } };
    } else if (type === 'referralCode') {
      searchCriteria = { referralCode: { $regex: query, $options: 'i' } };
    } else {
      // Search by mobile or referral code
      searchCriteria = {
        $or: [
          { mobile: { $regex: query, $options: 'i' } },
          { referralCode: { $regex: query, $options: 'i' } }
        ]
      };
    }

    const users = await User.find(searchCriteria)
      .select('-password')
      .limit(50)
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    console.error("User search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get all users with pagination and filters
app.get("/admin/users/list", adminAuth, async (req, res) => {
  try {
    console.log('📋 [ADMIN] Loading users list - Page:', req.query.page, 'Filter:', req.query.filter);
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const filter = req.query.filter || 'all';
    let query = {};

    if (filter === 'deposited') {
      query.deposited = true;
    } else if (filter === 'banned') {
      query.banned = true;
    } else if (filter === 'active') {
      // Users who bet in last 7 days
      const activeMobiles = await Bet.distinct('mobile', {
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      });
      query.mobile = { $in: activeMobiles };
    }

    const totalUsers = await User.countDocuments(query);
    console.log('  Total users in query:', totalUsers);
    
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    console.log('✅ [ADMIN] Returning', users.length, 'users');

    res.json({
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
        limit
      }
    });
  } catch (err) {
    console.error("❌ [ADMIN] Users list error:", err.message, err.stack);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// Reset user password
app.post("/admin/user/:mobile/reset-password", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const bcrypt = require('bcryptjs');
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    console.log(`Admin reset password for user: ${mobile}`);

    res.json({
      message: "Password reset successfully"
    });
  } catch (err) {
    console.error("Password reset error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Add bonus to user account
app.post("/admin/user/:mobile/add-bonus", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;
    const { amount, reason } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid bonus amount" });
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.bonus = Math.round((user.bonus + amount) * 100) / 100;
    await user.save();

    console.log(`Admin added bonus: ${mobile} +₹${amount} - ${reason || 'Manual bonus'}`);

    res.json({
      message: "Bonus added successfully",
      newBonus: user.bonus
    });
  } catch (err) {
    console.error("Add bonus error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete user account
app.delete("/admin/user/:mobile", adminAuth, async (req, res) => {
  try {
    const { mobile } = req.params;

    const user = await User.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete associated data
    await Bet.deleteMany({ mobile });
    await Deposit.deleteMany({ mobile });
    await Withdraw.deleteMany({ mobile });
    await Referral.deleteMany({ $or: [{ fromMobile: mobile }, { toMobile: mobile }] });
    await GiftCode.deleteMany({ createdBy: mobile });
    
    await User.deleteOne({ mobile });

    console.log(`Admin deleted user: ${mobile}`);

    res.json({
      message: "User deleted successfully"
    });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get admin gift codes overview
app.get("/admin/giftcodes", adminAuth, async (req, res) => {
  try {
    const giftCodes = await GiftCode.find()
      .sort({ createdAt: -1 })
      .limit(100);

    const stats = {
      total: await GiftCode.countDocuments(),
      active: await GiftCode.countDocuments({ status: 'active' }),
      expired: await GiftCode.countDocuments({ status: 'expired' }),
      fullyRedeemed: await GiftCode.countDocuments({ status: 'fully-redeemed' }),
      totalAmount: giftCodes.reduce((sum, gc) => sum + (gc.amount * gc.redemptionCount), 0)
    };

    res.json({
      giftCodes,
      stats
    });
  } catch (err) {
    console.error("Admin gift codes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete gift code (admin)
app.delete("/admin/giftcode/:code", adminAuth, async (req, res) => {
  try {
    const { code } = req.params;

    const giftCode = await GiftCode.findOneAndDelete({ code: code.toUpperCase() });
    if (!giftCode) {
      return res.status(404).json({ error: "Gift code not found" });
    }

    console.log(`Admin deleted gift code: ${code}`);

    res.json({
      message: "Gift code deleted successfully"
    });
  } catch (err) {
    console.error("Delete gift code error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
GIFT CODE SYSTEM - USER ENDPOINTS
========================= */

// Create gift code
app.post("/giftcode/create", auth, async (req, res) => {
  try {
    const { amount, type, maxRedemptions, validityDays, description } = req.body;

    // Validate inputs
    if (!amount || amount < 10) {
      return res.status(400).json({ error: "Minimum gift amount is ₹10" });
    }

    if (amount > 10000) {
      return res.status(400).json({ error: "Maximum gift amount is ₹10,000" });
    }

    if (!['one-to-one', 'one-to-many'].includes(type)) {
      return res.status(400).json({ error: "Invalid gift code type" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user has sufficient balance
    if (user.wallet < amount) {
      return res.status(400).json({ 
        error: `Insufficient balance. You need ₹${amount} to create this gift code.` 
      });
    }

    // Deduct amount from user's wallet
    user.wallet = Math.round((user.wallet - amount) * 100) / 100;
    await user.save();

    // Generate unique code
    const generateCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    };

    let code = generateCode();
    let attempts = 0;
    
    // Ensure code is unique
    while (await GiftCode.findOne({ code }) && attempts < 10) {
      code = generateCode();
      attempts++;
    }

    // Calculate expiry date
    const validity = validityDays || 30; // Default 30 days
    const expiresAt = new Date(Date.now() + validity * 24 * 60 * 60 * 1000);

    // Create gift code
    const giftCode = await GiftCode.create({
      code,
      createdBy: user.mobile,
      amount,
      type,
      maxRedemptions: type === 'one-to-one' ? 1 : (maxRedemptions || 999999),
      expiresAt,
      description: description || `Gift from ${user.mobile.substring(0, 4)}****`
    });

    console.log(`🎁 Gift code created: ${code} by ${user.mobile} - ₹${amount} (${type})`);

    res.json({
      message: "Gift code created successfully",
      giftCode: {
        code: giftCode.code,
        amount: giftCode.amount,
        type: giftCode.type,
        expiresAt: giftCode.expiresAt,
        maxRedemptions: giftCode.maxRedemptions
      },
      newWallet: user.wallet
    });
  } catch (err) {
    console.error("Create gift code error:", err);
    res.status(500).json({ error: "Failed to create gift code" });
  }
});

// Redeem gift code
app.post("/giftcode/redeem", auth, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Gift code is required" });
    }

    const user = await User.findOne({ mobile: req.user.mobile });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const giftCode = await GiftCode.findOne({ code: code.toUpperCase() });
    if (!giftCode) {
      return res.status(404).json({ error: "Invalid gift code" });
    }

    // Check if code can be redeemed
    const canRedeem = giftCode.canRedeem(user.mobile);
    if (!canRedeem.success) {
      return res.status(400).json({ error: canRedeem.message });
    }

    // Redeem the code
    giftCode.redeem(user.mobile);
    await giftCode.save();

    // Add amount to user's bonus
    user.bonus = Math.round((user.bonus + giftCode.amount) * 100) / 100;
    await user.save();

    console.log(`🎁 Gift code redeemed: ${code} by ${user.mobile} - ₹${giftCode.amount}`);

    res.json({
      message: `Gift code redeemed! ₹${giftCode.amount} added to your bonus`,
      amount: giftCode.amount,
      newBonus: user.bonus
    });
  } catch (err) {
    console.error("Redeem gift code error:", err);
    res.status(500).json({ error: "Failed to redeem gift code" });
  }
});

// Get user's created gift codes
app.get("/giftcode/my-codes", auth, async (req, res) => {
  try {
    const giftCodes = await GiftCode.find({ createdBy: req.user.mobile })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(giftCodes);
  } catch (err) {
    console.error("My gift codes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get user's redeemed gift codes
app.get("/giftcode/redeemed", auth, async (req, res) => {
  try {
    const giftCodes = await GiftCode.find({
      'redeemedBy.mobile': req.user.mobile
    })
      .sort({ createdAt: -1 })
      .limit(50);

    const redeemedCodes = giftCodes.map(gc => {
      const redemption = gc.redeemedBy.find(r => r.mobile === req.user.mobile);
      return {
        code: gc.code,
        amount: gc.amount,
        redeemedAt: redemption.redeemedAt,
        createdBy: gc.createdBy
      };
    });

    res.json(redeemedCodes);
  } catch (err) {
    console.error("Redeemed gift codes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Verify gift code (check without redeeming)
app.post("/giftcode/verify", auth, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Gift code is required" });
    }

    const giftCode = await GiftCode.findOne({ code: code.toUpperCase() });
    if (!giftCode) {
      return res.status(404).json({ error: "Invalid gift code" });
    }

    const canRedeem = giftCode.canRedeem(req.user.mobile);

    res.json({
      valid: canRedeem.success,
      message: canRedeem.message || 'Gift code is valid',
      giftCode: canRedeem.success ? {
        code: giftCode.code,
        amount: giftCode.amount,
        type: giftCode.type,
        expiresAt: giftCode.expiresAt,
        description: giftCode.description
      } : null
    });
  } catch (err) {
    console.error("Verify gift code error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete own gift code
app.delete("/giftcode/:code", auth, async (req, res) => {
  try {
    const { code } = req.params;

    const giftCode = await GiftCode.findOne({ 
      code: code.toUpperCase(),
      createdBy: req.user.mobile 
    });

    if (!giftCode) {
      return res.status(404).json({ error: "Gift code not found or not created by you" });
    }

    // Check if already redeemed
    if (giftCode.redemptionCount > 0) {
      return res.status(400).json({ 
        error: "Cannot delete a gift code that has been redeemed" 
      });
    }

    // Refund the amount to user
    const user = await User.findOne({ mobile: req.user.mobile });
    user.wallet = Math.round((user.wallet + giftCode.amount) * 100) / 100;
    await user.save();

    await GiftCode.deleteOne({ _id: giftCode._id });

    console.log(`🎁 Gift code deleted: ${code} by ${req.user.mobile} - Refunded ₹${giftCode.amount}`);

    res.json({
      message: `Gift code deleted and ₹${giftCode.amount} refunded to your wallet`,
      newWallet: user.wallet
    });
  } catch (err) {
    console.error("Delete gift code error:", err);
    res.status(500).json({ error: "Failed to delete gift code" });
  }
});

/* =========================
SERVER START
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🎮 BIGWIN Backend Server - ENHANCED');
  console.log('='.repeat(50));
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 API URL: http://localhost:${PORT}`);
  console.log(`📊 MongoDB: Connected`);
  console.log(`⏰ Round Duration: 60 seconds`);
  console.log(`🏦 House Edge: 2%`);
  console.log(`🎁 Registration Bonus: ₹50 bonus`);
  console.log(`💰 First Deposit Bonus: 20%`);
  console.log(`🎁 Gift Code System: Enabled`);
  console.log(`💰 Referral Levels: 6 (11% total commission)`);
  console.log(`👑 Admin Panel: Enhanced`);
  console.log('='.repeat(50) + '\n');
});
