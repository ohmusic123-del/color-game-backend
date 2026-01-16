const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: "Token missing" });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach user info to request
        req.user = decoded;
        next();
    } catch (err) {
        console.error('Auth middleware error:', err.message);
        
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: "Token expired" });
        }
        
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: "Invalid token" });
        }
        
        return res.status(401).json({ error: "Unauthorized" });
    }
};
