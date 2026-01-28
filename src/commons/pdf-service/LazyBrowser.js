const bunyan = require("bunyan");
const { chromium } = require("playwright");

const logger = bunyan.createLogger({
  name: "mail-service.js",
  level: process.env.LOG_LEVEL,
});

class LazyBrowser {
  constructor(idleTimeout = 5 * 60 * 1000) {
    this.browser = null;
    this.idleTimeout = idleTimeout;
    this.timeoutId = null;
    this.activeRequests = 0;
  }

  async getBrowser() {
    if (!this.browser) {
      logger.info("Starting browser instance...");
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
    }

    this.resetTimeout();
    return this.browser;
  }

  resetTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(async () => {
      if (this.activeRequests === 0 && this.browser) {
        logger.info("Closing idle browser instance...");
        await this.browser.close();
        this.browser = null;
      }
    }, this.idleTimeout);
  }

  async execute(fn) {
    this.activeRequests++;
    try {
      const browser = await this.getBrowser();
      return await fn(browser);
    } finally {
      this.activeRequests--;
      this.resetTimeout();
    }
  }

  async cleanup() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.browser) await this.browser.close();
  }
}

const lazyBrowser = new LazyBrowser();

module.exports = lazyBrowser;
