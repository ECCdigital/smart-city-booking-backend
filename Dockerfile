FROM node:slim

# Set Puppeteer to skip downloading Chromium since we'll be installing it manually
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

# Install Google Chrome
RUN apt-get update && apt-get install -y wget gnupg && \
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Expose port 8080 and start the application
EXPOSE 8080
CMD [ "node", "src/server.js" ]