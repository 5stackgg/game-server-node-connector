FROM node:24 AS deps

WORKDIR /build
COPY package*.json ./
COPY yarn.lock ./

RUN yarn install

FROM node:24 AS builder

WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY . .

RUN yarn build

FROM node:24

WORKDIR /opt/5stack

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    containerd \
    dmidecode \
    unzip \
    util-linux \
  && rm -rf /var/lib/apt/lists/*

# crictl for resources/image-prune.sh; Debian does not package it.
ARG CRICTL_VERSION=v1.37.0
ARG TARGETARCH
RUN url="https://github.com/kubernetes-sigs/cri-tools/releases/download/${CRICTL_VERSION}/crictl-${CRICTL_VERSION}-linux-${TARGETARCH}.tar.gz" \
  && curl -fsSLo /tmp/crictl.tar.gz "$url" \
  && echo "$(curl -fsSL "$url.sha256")  /tmp/crictl.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/crictl.tar.gz -C /usr/local/bin crictl \
  && rm /tmp/crictl.tar.gz

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist 
COPY --from=builder /build/public ./public  
COPY --from=builder /build/views ./views  
COPY --from=builder /build/resources ./resources  

CMD [ "node", "dist/main.js" ]
