import utils from 'ethereumjs-util'
import {Router} from 'express'
import {Validator} from 'jsonschema'

import chain from '../chain'
import {getAllUTXOs, getTxByHash} from '../chain/manager'

// RPC schema and validator
const rpcSchema = {
  id: '/RpcInput',
  type: 'object',
  properties: {
    jsonrpc: {type: 'string'},
    method: {type: 'string', required: true},
    params: {type: 'array', required: true},
    id: {type: 'number'}
  }
}
const rpcValidator = new Validator()

// create router
const routes = Router()

const methods = {
  async getBlockByNumber([blockNumber]) {
    let block = {}
    try {
      const obj = await chain.getBlock(blockNumber)
      if (obj) {
        block = obj.toJSON(true)
      }
    } catch (e) {}
    return block
  },

  async getBlockByHash([blockHash]) {
    let block = {}
    try {
      const obj = await chain.getBlock(utils.toBuffer(blockHash))
      if (obj) {
        block = obj.toJSON(true)
      }
    } catch (e) {}
    return block
  },

  async sendTx([txBytes]) {
    try {
      const hash = await chain.addTx(txBytes)
      return utils.bufferToHex(hash)
    } catch (e) {}

    return null
  },

  async getTxByHash([txHash]) {
    let tx = {}
    try {
      const obj = await getTxByHash(txHash)
      if (obj) {
        tx = obj.toJSON(true)
      }
    } catch (e) {}

    return tx
  },

  async getUTXOs([address]) {
    try {
      return await getAllUTXOs(address)
    } catch (e) {}
    return []
  }
}

/**
 * POST RPC data
 */
routes.post('/', (req, res) => {
  const data = req.body
  const v = rpcValidator.validate(data, rpcSchema)
  if (v.errors && v.errors.length > 0) {
    return res.status(400).json({
      code: 'input-error',
      message: v.errors[0].stack
    })
  }

  const fn = methods[data.method]
  if (!fn) {
    return res.status(404).json({
      message: 'No method found.',
      error: true
    })
  }

  fn(data.params)
    .then(result => {
      return res.json({
        id: data.id,
        jsonrpc: data.jsonrpc,
        result: result
      })
    })
    .catch(e => {
      return res.status(400).json({
        message: e.toString(),
        error: true
      })
    })
})

export default routes
