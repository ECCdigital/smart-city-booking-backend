FROM node:21.6.1-alpine

# Installieren Sie die notwendigen Abhängigkeiten für Puppeteer
RUN apk add --no-cache \
    ca-certificates \
    curl \
    wget \
    g++ \
    gcc \
    libx11-dev \
    libxkbfile-dev \
    libsecret-dev \
    make \
    python3 \
    xvfb \
    ttf-freefont \
    nss

# Setzen Sie die Umgebungsvariable für Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Setzen Sie das Arbeitsverzeichnis
WORKDIR /app

# Kopieren Sie die Dateien package.json und package-lock.json (falls vorhanden)
COPY package*.json ./

# Installieren Sie die Projektabhängigkeiten
RUN npm install

# Kopieren Sie den Rest der Anwendung
COPY . .

# Expose port 8080 and start the application
EXPOSE 8080
CMD [ "node", "src/server.js" ]