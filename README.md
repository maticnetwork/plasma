# Plasma MVP

[![Build Status](https://travis-ci.org/maticnetwork/plasma.svg?branch=master)](https://travis-ci.org/maticnetwork/plasma)

Install dependencies with

```
$ npm install
```

Run test cases:

```
# start test rpc server (which starts server on localhost:8545)
$ npm run testrpc

# run test cases
$ npm run test
```

### Development

```
# start test rpc server or you can start `geth`/`parity` node
$ npm run testrpc

# start dagger test server (which uses test RPC server at http://localhost:8545)
$ npm run dagger

# deploy contracts
$ npm run deploy

# start dev server
$ npm run dev
```

### Production

```
# build server
$ npm run build

# start server
$ npm start
```

#### Configurations

You can override default configurations by creating `config.env` file in root directory and adding following variables:

| Variable                    | Description                                                                                          | Default                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| APP_NAME                    | Name shown on UI                                                                                     | Plasma chain            |
| APP_PORT                    | Server port                                                                                          | 8080                    |
| CHAIN_DB                    | Level db location                                                                                    | `./db`                  |
| CHAIN_BLOCK_PERIOD          | Plasma chain block period. After every block period, new plasma block will be created, if necessary. | 6                       |
| CHAIN_WEB3_PROVIDER         | Web3 http provider URL                                                                               | `http://localhost:8545` |
| CHAIN_ROOT_CONTRACT         | Contract address for root contract                                                                   | `0xb4ee...a6a`          |
| CHAIN_DAGGER                | Mqtt URL for dagger server's endpoint                                                                | `mqtt://localhost:1883` |
| CHAIN_AUTHORITY_ADDRESS     | Authority address for PoA                                                                            | `0x9fB2...791`          |
| CHAIN_AUTHORITY_PRIVATE_KEY | Authority's private key for PoA                                                                      | `0x9b28...5d3`          |
