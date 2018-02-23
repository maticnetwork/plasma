import path from 'path'
import dotenv from 'dotenv'
import {Buffer} from 'safe-buffer'

// load config env
let root = path.normalize(`${__dirname}/../..`)
const configFile = process.env.CONFIG_FILE || `${root}/config.env`
dotenv.config({path: configFile, silent: true})

export default {
  env: process.env.NODE_ENV || 'development',
  debug: process.env.NODE_ENV !== 'production',
  app: {
    name: process.env.APP_NAME || 'Plasma Chain',
    port: process.env.APP_PORT || 8080
  },
  // level db prefixes
  prefixes: {
    blockDetails: Buffer.from('blockDetails'),
    utxo: Buffer.from('utxo'),
    deposit: Buffer.from('deposit'),
    tx: Buffer.from('tx'),
    txpool: Buffer.from('txpool'),
    latestHead: Buffer.from('latestHead'),
    latestRootBlock: Buffer.from('latestRootBlock')
  },
  chain: {
    db: process.env.CHAIN_DB || './db',
    blockPeriod: parseInt(process.env.CHAIN_BLOCK_PERIOD || 6), // submit block after every 6 root blocks
    web3Provider: process.env.CHAIN_WEB3_PROVIDER || 'http://localhost:8545',
    rootChainContract:
      process.env.CHAIN_ROOT_CONTRACT ||
      '0xb4ee6879ba231824651991c8f0a34af4d6bfca6a',
    daggerEndpoint: process.env.CHAIN_DAGGER || 'mqtt://localhost:1883',

    // authority details
    authority: {
      address:
        process.env.CHAIN_AUTHORITY_ADDRESS ||
        '0x9fB29AAc15b9A4B7F17c3385939b007540f4d791',
      privateKey:
        process.env.CHAIN_AUTHORITY_PRIVATE_KEY ||
        '0x9b28f36fbd67381120752d6172ecdcf10e06ab2d9a1367aac00cdcd6ac7855d3'
    },

    // important flag to check if it's authorized node
    authorizedNode: process.env.CHAIN_AUTHORIZED_NODE === 'true',

    // account details
    account: {
      address:
        process.env.CHAIN_ACCOUNT_ADDRESS ||
        '0x9fB29AAc15b9A4B7F17c3385939b007540f4d791',
      privateKey:
        process.env.CHAIN_PRIVATE_KEY ||
        '0x9b28f36fbd67381120752d6172ecdcf10e06ab2d9a1367aac00cdcd6ac7855d3'
    },

    // network port (for sync mechanism)
    network: {
      externalHost: process.env.NETWORK_EXTERNAL_HOST || '0.0.0.0',
      port: parseInt(process.env.NETWORK_PORT || 8081, 10),
      peers: (process.env.NETWORK_PEERS || '')
        .split(',')
        .map(peer => peer.trim())
        .filter(peer => !!peer)
    }
  }
}
