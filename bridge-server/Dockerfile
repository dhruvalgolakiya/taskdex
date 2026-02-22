FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci
RUN npm install -g @openai/codex

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV PORT=3001
ENV CODEX_CWD=/workspace

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/health?key=' + encodeURIComponent(process.env.API_KEY || '')).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
