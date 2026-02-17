FROM node:22-alpine

LABEL org.opencontainers.image.source=https://github.com/sion42x/omicron-tuf-browser

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN chown -R 568:568 /app

USER 568

EXPOSE 30080

ENV PORT=30080

CMD ["node", "server.js"]
