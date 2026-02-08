FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Create directories for uploads and configs
RUN mkdir -p /app/uploads /app/configs

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
