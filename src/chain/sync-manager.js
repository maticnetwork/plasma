import net from 'net'
import utils from 'ethereumjs-util'

import Block from './block'
import Peer from '../lib/peer'

const BN = utils.BN

export default class SyncManager {
  constructor(chain, options) {
    this.chain = chain
    this.options = options
    this.syncing = true

    // peers
    this.peers = []
  }

  async start() {
    // set status to syncing
    this.syncing = true

    // Create a server and listen to peer messages
    this.server = net.createServer(socket => {
      console.log('New node connected', socket.remoteAddress, socket.remotePort)

      socket.on('end', () => {
        console.error('Server socket connection ended')
      })
      socket.on('data', data => {
        this.handleMessage(data, socket)
      })
    })

    // Listen on port
    await new Promise((resolve, reject) => {
      this.server.listen(this.options.port, err => {
        if (err) {
          reject(err)
        } else {
          console.log(`Network sync started on port ${this.options.port}`)
          resolve()
        }
      })
    })

    // clean peers
    this.pingPeers()

    // add config peers
    this.options.peers.forEach(p => {
      this.addPeer(p)
    })

    // sync
    this.sync()
  }

  async stop() {
    // stop pinging peers
    clearTimeout(this.pingPeersIntervalId)
  }

  get hostString() {
    return `${this.options.externalHost}:${this.options.port}`
  }

  pingPeers() {
    // ping again after 30 seconds
    this.pingPeersIntervalId = setTimeout(() => {
      // clean peers
      this.pingPeers()

      // clean peers
      this.cleanPeers()

      // add config peers
      this.options.peers.forEach(p => {
        this.addPeer(p)
      })

      // sync
      this.sync()
    }, 5000) // TODO: change it to 30000

    const ping = JSON.stringify({
      type: 'PING',
      from: this.hostString,
      data: null
    })

    Object.keys(this.peers).forEach(p => {
      this.peers[p].send('msg', ping)
    })
  }

  cleanPeers() {
    Object.keys(this.peers).forEach(i => {
      if (this.peers[i].state === 'closed') {
        delete this.peers[i]
      }
    })
  }

  addPeer(host) {
    const [h, p] = host.split(':')
    if (
      h !== this.options.externalHost ||
      parseInt(p) !== parseInt(this.options.port)
    ) {
      let peer = this.peers[host]
      if (!peer) {
        peer = new Peer(h, p)
        peer.connect()
        this.peers[host] = peer

        const l = Object.keys(this.peers).length
        console.log(`Added peer connection: ${l} connection(s).`)
      }
    }
  }

  async sync() {
    // get latest current child block
    let [childBlockNumber, latestBlockDetails] = await Promise.all([
      this.chain.parentContract.methods.currentChildBlock().call(),
      this.chain.getLatestHead()
    ])
    childBlockNumber = new BN(childBlockNumber)

    let storedBlockNumber = new BN(0)
    if (latestBlockDetails) {
      storedBlockNumber = new BN(utils.toBuffer(latestBlockDetails.number))
    }

    if (storedBlockNumber.add(new BN(1)).lt(childBlockNumber)) {
      this._syncBlocks(storedBlockNumber.add(new BN(1)).toNumber())
    } else {
      // No new blocks to sync yet
      this.syncing = false
    }
  }

  broadcastNewTx(txBytes, excluded) {
    const message = JSON.stringify({
      type: 'ADD:TX',
      from: this.hostString,
      data: txBytes
    })

    // broadcast message
    this.broadcastMessage(message, excluded)
  }

  broadcastMessage(message, excluded = []) {
    Object.keys(this.peers).forEach(p => {
      if (
        this.peers[p] &&
        this.peers[p].state === 'connected' &&
        excluded.indexOf(p) === -1
      ) {
        this.peers[p].send('msg', message)
      }
    })
  }

  handleMessage(rawData, socket) {
    const msg = JSON.parse(rawData.toString('utf8'))
    let sender
    let data

    switch (msg.type) {
      case 'REQ:BLOCKS':
        sender = this.peers[msg.from]
        if (sender) {
          const fromBlock = +msg.fromBlock
          const p = []
          if (fromBlock > 0) {
            for (let i = fromBlock; i < fromBlock + 5; i++) {
              p.push(this.chain.getBlock(i))
            }

            Promise.all(p)
              .then((result = []) => {
                result = result
                  .filter(r => r)
                  .map(r => utils.bufferToHex(r.serialize()))

                // send blocks
                sender.send(
                  'msg',
                  JSON.stringify({
                    type: 'RES:BLOCKS',
                    from: this.hostString,
                    data: result
                  })
                )
              })
              .catch(e => {
                // supress error if any
              })
          }
        }
        break
      case 'RES:BLOCKS':
        data = msg.data || []
        this.chain.putBlocks(
          data.map(d => {
            return new Block(utils.toBuffer(d))
          })
        )
        break
      case 'RES:PEERS':
        data = msg.data || []
        // add new peers
        data.forEach(d => {
          this.addPeer(d)
        })
        break
      case 'REQ:PEERS':
        sender = this.peer[msg.from]
        if (sender) {
          sender.send(
            'msg',
            JSON.stringify({
              type: 'RES:PEERS',
              from: this.hostString,
              data: Object.keys(this.peers)
            })
          )
        }
        break
      case 'ADD:TX':
        sender = this.peers[msg.from]
        if (sender) {
          this.chain.addTx(msg.data, [msg.from])
        }
        break
      case 'PING':
        this.addPeer(msg.from)
        break
      default:
        break
    }
  }

  //
  // Sync blocks
  //
  _syncBlocks(start) {
    const peers = this._getRandomPeers()
    peers.forEach(p => {
      // requesting blocks
      p.send(
        'msg',
        JSON.stringify({
          type: 'REQ:BLOCKS',
          from: this.hostString,
          fromBlock: start,
          data: null
        })
      )
    })
  }

  //
  // Utils functions
  //
  _getRandomPeers(n = 2) {
    const peers = Object.keys(this.peers)
    if (!peers || peers.length === 0) {
      return []
    }

    const arr = []
    while (arr.length < Math.min(peers.length, n)) {
      const rn = Math.floor(Math.random() * peers.length)
      if (arr.indexOf(rn) > -1) {
        continue
      }
      arr.push(rn)
    }
    return arr.map(a => this.peers[peers[a]])
  }
}
