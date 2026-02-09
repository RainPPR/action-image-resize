FROM node:alpine

# Install essential dependencies for sharp on Alpine
RUN apk add --no-cache \
    vips-dev \
    build-base

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.js ./

ENTRYPOINT ["node", "/app/index.js"]
