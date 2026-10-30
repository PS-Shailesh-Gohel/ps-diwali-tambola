# Node 20 LTS on Alpine. The "node" user in this image is UID/GID 1000,
# which matches the EFS access point in aws_tambola.tf.
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

# Install production dependencies first so this layer is cached between builds
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Game save folder. ECS mounts EFS here at runtime, so this only matters for
# local runs of the image. Owned by the node user so the app can write game.json.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

CMD ["npm", "start"]
