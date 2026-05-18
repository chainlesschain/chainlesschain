FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=9001
ENV HOST=0.0.0.0

EXPOSE 9001

# 非 root 跑
RUN addgroup -S relay && adduser -S relay -G relay
USER relay

CMD ["node", "server.js"]
