const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
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
        console.error('Admin middleware error:', err.message);
        
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: "Admin token expired" });
        }
        
        return res.status(401).json({ error: "Invalid admin token" });
    }
};
