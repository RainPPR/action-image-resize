FROM node:slim

# Install system dependencies for sharp
RUN apt-get update && apt-get install -y \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json .

# Standard install for Debian-based slim image
RUN npm install

COPY index.js ./

ENTRYPOINT ["node", "/app/index.js"]
