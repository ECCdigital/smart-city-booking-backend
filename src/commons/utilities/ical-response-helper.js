function sendIcalResponse(res, cal, filename) {
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}.ics"`,
  );
  res.send(cal.toString());
}

function sendIcalFeed(res, cal) {
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.send(cal.toString());
}

module.exports = { sendIcalResponse, sendIcalFeed };
