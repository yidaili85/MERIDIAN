# syntax=docker/dockerfile:1
# MERIDIAN store — 无第三方运行依赖，Node 24 内置 SQLite
FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

# 只复制运行所需文件（测试目录保留，方便容器内跑 npm test）
COPY package.json server.js payments.js mailer.js smtp.js countries.js ./
COPY public ./public
COPY test ./test
COPY test-support ./test-support
COPY scripts ./scripts

RUN addgroup -S app && adduser -S -G app app \
 && mkdir -p /data && chown -R app:app /data /app

USER app
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
