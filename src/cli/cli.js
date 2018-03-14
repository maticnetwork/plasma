import repl from 'repl'
import yargs from 'yargs'
import Web3 from 'web3'
import {Buffer} from 'safe-buffer'
import utils from 'ethereumjs-util'
import axios from 'axios'

import config from '../config'
import RootChainArtifacts from '../../build/contracts/RootChain.json'
import Transaction from '../chain/transaction'

const BN = utils.BN
const rlp = utils.rlp
const web3 = new Web3(config.chain.web3Provider)
const rootChain = new web3.eth.Contract(
  RootChainArtifacts.abi,
  config.chain.rootChainContract
)

// Server connector setup
const serverURL = `http://localhost:${config.app.port}`
const axiosInstance = axios.create({
  baseURL: serverURL
})
// Add a request interceptor
let requestId = 1
axiosInstance.interceptors.request.use(
  function(requestConfig) {
    requestConfig.data.jsonrpc = '2.0'
    requestConfig.data.id = requestId++
    return requestConfig
  },
  function(error) {
    // Do something with request error
    return Promise.reject(error)
  }
)

//
// Command line parsing
//

const argv = yargs // eslint-disable-line
  .option('private-key', {
    alias: 'p',
    describe: 'private key to sign transactions',
    demandOption: true
  })
  .help().argv

const privateKey = utils.toBuffer(utils.addHexPrefix(argv.privateKey))
const sender = utils.bufferToHex(
  utils.pubToAddress(utils.privateToPublic(privateKey))
)

// add wallet into web3
web3.eth.accounts.wallet.add(utils.addHexPrefix(argv.privateKey))

//
// Command actions
//

// deposit
async function deposit(amount) {
  if (!amount) {
    throw new Error('')
  }

  const amountInWei = web3.utils.toWei(amount)
  const value = new BN(amountInWei)
  const depositTx = new Transaction([
    new Buffer([]), // block number 1
    new Buffer([]), // tx number 1
    new Buffer([]), // previous output number 1 (input 1)
    new Buffer([]), // block number 2
    new Buffer([]), // tx number 2
    new Buffer([]), // previous output number 2 (input 2)

    utils.toBuffer(sender), // output address 1
    value.toArrayLike(Buffer, 'be', 32), // value for output 2

    utils.zeros(20), // output address 2
    new Buffer([]), // value for output 2

    new Buffer([]) // fee
  ])

  // serialize tx bytes
  const txBytes = utils.bufferToHex(depositTx.serializeTx())

  // deposit
  const receipt = await rootChain.methods.deposit(txBytes).send({
    from: sender,
    gas: 200000,
    value: value.toString()
  })
  console.log('Transaction ID:', receipt.transactionHash)
  console.log('Block number:', receipt.blockNumber)
  console.log('Transaction index: ', receipt.transactionIndex)
  console.log('Note: This will take a while to appear in list of UTXOs.')
}

async function getUTXOs() {
  const {data} = await axiosInstance.post('/', {
    method: 'plasma_getUTXOs',
    params: [sender]
  })
  console.log('Total utxo available:', data.result.length)
  if (data.result.length > 0) {
    data.result.slice(0, 5).forEach(u => {
      const outputIndex = parseInt(u.outputIndex)
      const amount = parseInt(outputIndex === 0 ? u.tx.amount1 : u.tx.amount2)
      const pos = [parseInt(u.blockNumber), parseInt(u.txIndex), outputIndex]
      console.log(
        `Position: ${pos.join(' ')}, Amount: ${web3.utils.fromWei(
          amount.toString()
        )}`
      )
    })
  }
}

async function getTx(...args) {
  let method = null
  if (args.length === 3) {
    method = 'plasma_getTxByPos'
    args.unshift(sender)
  } else if (args.length === 1) {
    method = 'plasma_getTxByHash'
  } else {
    throw new Error(
      'Invalid arguments. For hash, pass transaction hash or pass positions'
    )
  }

  const {data} = await axiosInstance.post('/', {
    method: method,
    params: args
  })

  console.log(data.result)
}

async function transfer(...args) {
  if (args.length !== 11) {
    throw new Error('Invalid arguments.')
  }

  let transferTx = new Transaction([
    utils.toBuffer(args[0]), // block number for first input
    new Buffer(args[1]), // tx number for 1st input
    new Buffer(args[2]), // previous output number 1 (as 1st input)
    new Buffer(args[3]), // block number 2
    new Buffer(args[4]), // tx number 2
    new Buffer(args[5]), // previous output number 2 (as 2nd input)

    utils.isValidAddress(args[6]) ? utils.toBuffer(args[6]) : utils.zeros(20), // output address 1
    new BN(web3.utils.toWei(parseInt(args[7]).toString())).toArrayLike(
      Buffer,
      'be',
      32
    ), // value for output 2

    utils.isValidAddress(args[8]) ? utils.toBuffer(args[8]) : utils.zeros(20), // output address 2
    new BN(web3.utils.toWei(parseInt(args[9]).toString())).toArrayLike(
      Buffer,
      'be',
      32
    ), // value for output 2

    new Buffer([10]) // fee
  ])

  // generate proof
  transferTx.sign1(privateKey) // sign1
  const transferTxBytes = utils.bufferToHex(transferTx.serializeTx(true))

  const {data} = await axiosInstance.post('/', {
    method: 'plasma_sendTx',
    params: [transferTxBytes]
  })

  console.log('Transaction ID:', data.result)
}

//
// REPL server
//

const replServer = repl.start({prompt: 'plasma > '})
const wrapAction = fn => {
  return function(data) {
    const args = data.replace(/ +/, ' ').split(' ')
    const result = fn(...args)
    this.clearBufferedCommand()
    if (result instanceof Promise) {
      result
        .then(() => {
          this.displayPrompt()
        })
        .catch(e => {
          if (e && e.response && e.response.data) {
            console.log(e.response.status, e.response.data)
          } else if (e && e.request) {
            console.log(e.request)
          } else if (e && e.message) {
            console.log(e.message)
          } else {
            console.log(e)
          }
          this.displayPrompt()
        })
    } else {
      this.displayPrompt()
    }
  }
}

// context initializations
function initializeContext(context) {
  const contextObjects = {
    web3: web3,
    rootChain: rootChain,
    privateKey: privateKey,
    BN: BN,
    rlp: rlp,
    account: sender
  }

  Object.keys(contextObjects).forEach(k => {
    Object.defineProperty(replServer.context, k, {
      configurable: false,
      enumerable: true,
      value: contextObjects[k]
    })
  })
}

// command list
replServer.defineCommand('deposit', {
  help: 'Deposit ethers. Argument: amount. Example: .deposit 3',
  action: wrapAction(deposit)
})

replServer.defineCommand('utxo', {
  help: 'List UTXOs (shows upto 5)',
  action: wrapAction(getUTXOs)
})

replServer.defineCommand('tx', {
  help:
    'Get transaction by hash or positions. Arguments: txHash or blockNumber txIndex outputIndex. Example: .tx 2 0 0 OR .tx 0xab35...3df45',
  action: wrapAction(getTx)
})

replServer.defineCommand('transfer', {
  help:
    'Transfer plasma coins. Arguments: blk1 tIndex1 oIndex1 blk2 tIndex2 oIndex2 owner1 amount1 owner2 amount2 fee. Example: .transfer 1 0 0 0 0 0 0x9fb29aac15b9a4b7f17c3385939b007540f4d791 1 0x 0 0',
  action: wrapAction(transfer)
})

// refresh context on reset
initializeContext(replServer.context)
replServer.on('reset', initializeContext)
