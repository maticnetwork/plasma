pragma solidity 0.4.18;

import "./lib/SafeMath.sol";
import "./lib/Math.sol";
import "./lib/RLP.sol";
import "./lib/Merkle.sol";
import "./lib/Validate.sol";

import "./ds/PriorityQueue.sol";


contract RootChain {
  using SafeMath for uint256;
  using RLP for bytes;
  using RLP for RLP.RLPItem;
  using RLP for RLP.Iterator;
  using Merkle for bytes32;

  /*
   * Events
   */
  event Deposit(address depositor, uint256 amount);
  event ChildBlockCreated(uint256 blockNumber, bytes32 root);
  event DepositBlockCreated(uint256 blockNumber, bytes32 root, bytes txBytes);
  event StartExit(
    address indexed owner,
    uint256 blockNumber,
    uint256 txIndex,
    uint256 outputIndex
  );

  /*
   *  Storage
   */
  mapping(uint256 => ChildBlock) public childChain;
  mapping(uint256 => Exit) public exits;
  mapping(uint256 => uint256) public exitIds;

  PriorityQueue exitsQueue;

  address public authority;
  uint256 public currentChildBlock;
  uint256 public lastParentBlock;
  uint256 public recentBlock;
  uint256 public weekOldBlock;

  struct Exit {
    address owner;
    uint256 amount;
    uint256[3] utxoPos;
  }

  struct ChildBlock {
    bytes32 root;
    uint256 createdAt;
  }

  /*
   *  Modifiers
   */
  modifier isAuthority() {
    require(msg.sender == authority);
    _;
  }

  modifier incrementOldBlocks() {
    while (childChain[weekOldBlock].createdAt < block.timestamp.sub(1 weeks)) {
      if (childChain[weekOldBlock].createdAt == 0) {
        break;
      }
      weekOldBlock = weekOldBlock.add(1);
    }
    _;
  }

  function RootChain()
    public
  {
    authority = msg.sender;
    currentChildBlock = 1;
    lastParentBlock = block.number;
    exitsQueue = new PriorityQueue();
  }

  function submitBlock(bytes32 root)
    public
    isAuthority
    incrementOldBlocks
  {
    require(block.number >= lastParentBlock.add(6));
    childChain[currentChildBlock] = ChildBlock({
      root: root,
      createdAt: block.timestamp
    });
    ChildBlockCreated(currentChildBlock, root);

    currentChildBlock = currentChildBlock.add(1);
    lastParentBlock = block.number;
  }

  function deposit(bytes txBytes)
    public
    payable
  {
    var txList = txBytes.toRLPItem().toList();
    require(txList.length == 11);
    for (uint256 i; i < 6; i++) {
      require(txList[i].toUint() == 0);
    }
    require(txList[7].toUint() == msg.value);
    require(txList[9].toUint() == 0);
    bytes32 zeroBytes;
    bytes32 root = keccak256(keccak256(txBytes), new bytes(130));
    for (i = 0; i < 16; i++) {
      root = keccak256(root, zeroBytes);
      zeroBytes = keccak256(zeroBytes, zeroBytes);
    }
    childChain[currentChildBlock] = ChildBlock({
      root: root,
      createdAt: block.timestamp
    });
    ChildBlockCreated(currentChildBlock, root);
    DepositBlockCreated(currentChildBlock, root, txBytes);

    currentChildBlock = currentChildBlock.add(1);
    Deposit(txList[6].toAddress(), txList[7].toUint());
  }

  function getChildChain(uint256 blockNumber)
    public
    view
    returns (bytes32, uint256)
  {
    return (childChain[blockNumber].root, childChain[blockNumber].createdAt);
  }

  function getExit(uint256 priority)
    public
    view
    returns (address, uint256, uint256[3])
  {
    return (exits[priority].owner, exits[priority].amount, exits[priority].utxoPos);
  }

  function startExit(
    uint256[3] txPos,
    bytes txBytes,
    bytes proof,
    bytes sigs
  )
    public
    incrementOldBlocks
  {
    var txList = txBytes.toRLPItem().toList();
    require(txList.length == 11);
    require(msg.sender == txList[6 + 2 * txPos[2]].toAddress());
    bytes32 txHash = keccak256(txBytes);
    bytes32 merkleHash = keccak256(txHash, ByteUtils.slice(sigs, 0, 130));
    uint256 inputCount = txList[3].toUint() * 1000000 + txList[0].toUint();
    require(
      Validate.checkSigs(
        txHash,
        childChain[txPos[0]].root,
        inputCount,
        sigs
      )
    );
    require(merkleHash.checkMembership(txPos[1], childChain[txPos[0]].root, proof));
    uint256 priority = 1000000000 + txPos[1] * 10000 + txPos[2];
    uint256 exitId = txPos[0].mul(priority);
    priority = priority.mul(Math.max(txPos[0], weekOldBlock));
    require(exitIds[exitId] == 0);
    exitIds[exitId] = priority;
    exitsQueue.insert(priority);
    exits[priority] = Exit({
      owner: txList[6 + 2 * txPos[2]].toAddress(),
      amount: txList[7 + 2 * txPos[2]].toUint(),
      utxoPos: txPos
    });

    // broadcast start exit event
    StartExit(txList[6 + 2 * txPos[2]].toAddress(), txPos[0], txPos[1], txPos[2]);
  }

  function challengeExit(
    uint256 exitId,
    uint256[3] txPos,
    bytes txBytes,
    bytes proof,
    bytes sigs,
    bytes confirmationSig
  )
    public
  {
    var txList = txBytes.toRLPItem().toList();
    require(txList.length == 11);
    uint256 priority = exitIds[exitId];
    uint256[3] memory exitsUtxoPos = exits[priority].utxoPos;
    require(exitsUtxoPos[0] == txList[0 + 2 * exitsUtxoPos[2]].toUint());
    require(exitsUtxoPos[1] == txList[1 + 2 * exitsUtxoPos[2]].toUint());
    require(exitsUtxoPos[2] == txList[2 + 2 * exitsUtxoPos[2]].toUint());
    var txHash = keccak256(txBytes);
    var confirmationHash = keccak256(txHash, sigs, childChain[txPos[0]].root);
    var merkleHash = keccak256(txHash, sigs);
    address owner = exits[priority].owner;
    require(owner == ECRecovery.recover(confirmationHash, confirmationSig));
    require(merkleHash.checkMembership(txPos[1], childChain[txPos[0]].root, proof));
    delete exits[priority];
  }

  function finalizeExits()
    public
    incrementOldBlocks
    returns (uint256)
  {
    uint256 twoWeekOldTimestamp = block.timestamp.sub(2 weeks);
    Exit memory currentExit = exits[exitsQueue.getMin()];
    while (childChain[currentExit.utxoPos[0]].createdAt < twoWeekOldTimestamp && exitsQueue.currentSize() > 0) {
      uint256 exitId = currentExit.utxoPos[0] * 1000000000 + currentExit.utxoPos[1] * 10000 + currentExit.utxoPos[2];
      currentExit.owner.transfer(currentExit.amount);
      uint256 priority = exitsQueue.delMin();
      delete exits[priority];
      currentExit = exits[exitsQueue.getMin()];
    }
  }
}
