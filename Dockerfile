FROM node:18-alpine

# Install git (required by npm for some packages)
RUN apk add --no-cache git

WORKDIR /app

# Copy package files first (better caching)
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy rest of the app
COPY . .

# Expose port
EXPOSE 3000

# Start the bot
CMD ["node", "index.js"]
