# 构建上下文：仓库根目录
# 须先在宿主机执行: npm ci && npm run build
# 复制宿主机 node_modules（workspace 依赖已 hoist），避免镜像内 npm 与 ESM 解析差异

FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3922

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY node_modules node_modules
COPY packages/shared/dist packages/shared/dist
COPY apps/api/dist apps/api/dist

EXPOSE 3922

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3922/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
