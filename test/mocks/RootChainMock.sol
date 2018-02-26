pragma solidity ^0.4.18;


import "../../contracts/RootChain.sol";


contract RootChainMock is RootChain {

  function incrementWeekOldBlock() public {
    weekOldBlock = weekOldBlock.add(1);
  }

}