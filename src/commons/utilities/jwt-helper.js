const jwt = require('jsonwebtoken');

class JwtHelper {
  static generateToken(user) {
    const payload = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });
  }

  static generateRefreshToken(user) {
    return jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
  }

  static verifyToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET);
  }

  static verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  }
}

module.exports = JwtHelper;