# TransparentCars MCP — remote Streamable HTTP server
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY .well-known ./.well-known
RUN npm run build && npm prune --omit=dev
ENV MCP_HOST=0.0.0.0 PORT=8099
EXPOSE 8099
CMD ["node", "dist/http.js"]
