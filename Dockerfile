FROM node:24-alpine

WORKDIR /app

# No runtime dependencies, so there is nothing to install.
COPY package.json ./
COPY src ./src

ENTRYPOINT ["node", "src/cli.js"]
CMD ["--help"]
