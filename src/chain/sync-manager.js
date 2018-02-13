import net from 'net'
import utils from 'ethereumjs-util'

import Peer from '../lib/peer'

const BN = utils.BN

export default class SyncManager {
  constructor(chain, options) {
    this.chain = chain
    this.options = options

    // peers
    this.peers = []
  }

  async start() {
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

    // add peers from configuration
    this.options.peers.forEach(peer => {
      this.addPeer(peer)
    })

    setTimeout(() => {
      // ping peers
      this.pingPeers()

      // start syncing
      this.sync()
    }, 1000)
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
      this._syncBlocks()
    }
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
          sender.send('msg', {
            type: 'RES:PEERS',
            from: this.hostString,
            data: Object.keys(this.peers)
          })
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
  _syncBlock(start) {}
}
