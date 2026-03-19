# SnipCSS Actor - headless CDP extraction (no Chrome extension, no Xvfb)
# Build: npm run build:actor (from repo root) then apify push from actor/
FROM node:22-slim

WORKDIR /app

# Install actor runtime dependencies (apify, jimp, @aws-sdk, dotenv)
COPY package*.json ./
RUN npm ci

# Install playwright runtime (kept as peerDependency to avoid TS type conflicts during build)
RUN npm install playwright@1.48.2 --no-save

# Install Playwright Chromium + all system dependencies
RUN npx playwright install chromium --with-deps

# Copy pre-compiled JS output (run "npm run build:actor" from repo root first)
COPY dist/ ./dist/

CMD ["node", "dist/actor/src/main.js"]
