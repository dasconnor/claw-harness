FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb fonts-liberation libatk-bridge2.0-0 libdrm2 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libnspr4 libnss3 libxss1 libxtst6 \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g openclaw@latest
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
