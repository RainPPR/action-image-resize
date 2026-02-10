FROM node:slim

# Install system dependencies for sharp
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libvips-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json .

# Standard install for Debian-based slim image
RUN npm install -g npm && npm install

COPY index.js ./

ENTRYPOINT ["node", "/app/index.js"]
