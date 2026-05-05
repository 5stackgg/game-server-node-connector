FROM node:22 AS deps

WORKDIR /build
COPY package*.json ./
COPY yarn.lock ./

RUN yarn install

FROM node:22 AS builder

WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY . .

RUN yarn build

FROM node:22

WORKDIR /opt/5stack

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    containerd \
    dmidecode \
    util-linux \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist 
COPY --from=builder /build/public ./public  
COPY --from=builder /build/views ./views  
COPY --from=builder /build/resources ./resources  

CMD [ "node", "dist/main.js" ]
