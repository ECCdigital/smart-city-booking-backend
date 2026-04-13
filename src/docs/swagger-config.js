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
