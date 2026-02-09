FROM node:alpine

# Install build dependencies for sharp and node-gyp
RUN apk add --no-cache \
    vips \
    vips-dev \
    xpdf \
    build-base \
    python3 \
    glib-dev \
    libavif

WORKDIR /app

COPY package.json .

# Install dependencies, ensuring sharp is built for musl
RUN npm install --include=optional --platform=linuxmusl

COPY index.js ./

ENTRYPOINT ["node", "/app/index.js"]
