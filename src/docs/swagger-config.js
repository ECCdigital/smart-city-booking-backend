const swaggerJsdoc = require("swagger-jsdoc");
const path = require("path");

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Smart City Booking – API",
      version: "2.0.0",
      description: "API for managing bookables, events, bookings and more",
    },
    servers: [
      {
        url: process.env.API_BASE_URL || "http://localhost:8082",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Required on protected routes. Public routes take it optionally: " +
            "without it they answer anonymously, but a token sent along must " +
            "hold - an expired, revoked or invalid one is refused with 401 " +
            "and the same message as on a protected route " +
            '(e.g. `{ "success": false, "message": "Token has expired" }`).',
        },
      },
      schemas: {},
    },
  },
  apis: [
    path.join(__dirname, "../platform/api/routes/*.routes.js"),
    path.join(__dirname, "./routes/*.yaml"),
    path.join(__dirname, "./schemas/*.yaml"),
  ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
