FROM node:20-slim

# libaio1 및 cpio, rpm2cpio 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    libaio1 \
    cpio \
    rpm2cpio \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/oracle
COPY instantclient.rpm ./
RUN rpm2cpio instantclient.rpm | cpio -idmv && rm instantclient.rpm

ENV LD_LIBRARY_PATH=/opt/oracle/usr/lib/oracle/21/client64/lib:$LD_LIBRARY_PATH

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
