FROM node:22-alpine AS deps

WORKDIR /build
COPY package*.json ./
COPY yarn.lock ./

RUN yarn install

FROM node:22-alpine AS builder

WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY . .

RUN yarn build

FROM node:22-alpine

WORKDIR /opt/5stack

RUN apk add --no-cache util-linux bash containerd-ctr

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist 
COPY --from=builder /build/public ./public  
COPY --from=builder /build/views ./views  
COPY --from=builder /build/resources ./resources  

CMD [ "node", "dist/main.js" ]
