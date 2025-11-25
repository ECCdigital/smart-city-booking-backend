// Backward compatibility wrapper für die neue auth-middleware
const { requireAuth } = require('./auth-middleware');

// Exportiere requireAuth als jwtAuth für Backward Compatibility
module.exports = requireAuth;
