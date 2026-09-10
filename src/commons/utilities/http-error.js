// map an error to its HTTP status; never echo an internal message on a 5xx
function sendError(response, error, fallback) {
  const status = (error && (error.status || error.statusCode)) || 500;
  const body = status >= 500 ? fallback : (error && error.message) || fallback;
  return response.status(status).send(body);
}

module.exports = { sendError };
