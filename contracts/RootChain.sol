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

  PriorityQueue exitsQueue;

  address public authority;
  uint256 public currentChildBlock;
  uint256 public recentBlock;
  uint256 public weekOldBlock;

  struct Exit {
    address owner;
    uint256 amount;
    uint256 utxoPos;
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
    exitsQueue = new PriorityQueue();
  }

  function submitBlock(bytes32 root, uint256 blknum)
    public
    isAuthority
    incrementOldBlocks
  {
    require(blknum == currentChildBlock);
    childChain[currentChildBlock] = ChildBlock({
      root: root,
      createdAt: block.timestamp
    });
    ChildBlockCreated(currentChildBlock, root);
    currentChildBlock = currentChildBlock.add(1);
  }

  function deposit(bytes txBytes)
    public
    payable
  {
    var txList = txBytes.toRLPItem().toList(11);
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

  function getExit(uint256 exitId)
    public
    view
    returns (address, uint256, uint256)
  {
    return (exits[exitId].owner, exits[exitId].amount, exits[exitId].utxoPos);
  }

  // @dev Starts to exit a specified utxo
  // @param utxoPos The position of the exiting utxo in the format of blknum * 1000000000 + index * 10000 + oindex
  // @param txBytes The transaction being exited in RLP bytes format
  // @param proof Proof of the exiting transactions inclusion for the block specified by utxoPos
  // @param sigs Both transaction signatures and confirmations signatures used to verify that the exiting transaction has been confirmed
  function startExit(
    uint256 utxoPos,
    bytes txBytes,
    bytes proof,
    bytes sigs
  )
    public
    incrementOldBlocks
  {
    var txList = txBytes.toRLPItem().toList(11);
    uint256 blknum = utxoPos / 1000000000;
    uint256 txindex = (utxoPos % 1000000000) / 10000;
    uint256 oindex = utxoPos - blknum * 1000000000 - txindex * 10000;

    require(txList.length == 11);
    require(msg.sender == txList[6 + 2 * oindex].toAddress());
    bytes32 txHash = keccak256(txBytes);
    bytes32 merkleHash = keccak256(txHash, ByteUtils.slice(sigs, 0, 130));
    uint256 inputCount = txList[3].toUint() * 1000000000 + txList[0].toUint();
    require(
      Validate.checkSigs(
        txHash,
        childChain[blknum].root,
        inputCount,
        sigs
      )
    );
    require(merkleHash.checkMembership(txindex, childChain[blknum].root, proof));

    // Priority is a given utxos position in the exit priority queue
    uint256 priority;
    if (blknum < weekOldBlock) {
      priority = (utxoPos / blknum).mul(weekOldBlock);
    } else {
      priority = utxoPos;
    }

    require(exits[utxoPos].amount == 0);
    exitsQueue.insert((priority << 128) | utxoPos);
    exits[utxoPos] = Exit({
      owner: txList[6 + 2 * oindex].toAddress(),
      amount: txList[7 + 2 * oindex].toUint(),
      utxoPos: utxoPos
    });

    // broadcast start exit event
    StartExit(txList[6 + 2 * oindex].toAddress(), blknum, txindex, oindex);
  }

  // @dev Allows anyone to challenge an exiting transaction by submitting proof of a double spend on the child chain
  // @param cUtxoPos The position of the challenging utxo
  // @param eUtxoPos The position of the exiting utxo
  // @param txBytes The challenging transaction in bytes RLP form
  // @param proof Proof of inclusion for the transaction used to challenge
  // @param sigs Signatures for the transaction used to challenge
  // @param confirmationSig The confirmation signature for the transaction used to challenge
  function challengeExit(
    uint256 cUtxoPos,
    uint256 eUtxoPos,
    bytes txBytes,
    bytes proof,
    bytes sigs,
    bytes confirmationSig
  )
    public
  {
    uint256 txindex = (cUtxoPos % 1000000000) / 10000;
    bytes32 root = childChain[cUtxoPos / 1000000000].root;

    var txHash = keccak256(txBytes);
    var confirmationHash = keccak256(txHash, root);
    var merkleHash = keccak256(txHash, sigs);
    address owner = exits[eUtxoPos].owner;

    require(owner == ECRecovery.recover(confirmationHash, confirmationSig));
    require(merkleHash.checkMembership(txindex, root, proof));
    delete exits[eUtxoPos];
  }

  function finalizeExits()
    public
    incrementOldBlocks
    returns (uint256)
  {
    uint256 twoWeekOldTimestamp = block.timestamp.sub(2 weeks);
    Exit memory currentExit = exits[uint128(exitsQueue.getMin())];
    uint256 blknum = currentExit.utxoPos.div(1000000000);

    while (childChain[blknum].createdAt < twoWeekOldTimestamp && exitsQueue.currentSize() > 0) {
      currentExit.owner.transfer(currentExit.amount);
      uint256 priority = exitsQueue.delMin();
      delete exits[priority];
      currentExit = exits[exitsQueue.getMin()];
    }
  }
}
