pragma solidity 0.4.18;

import "../token/StandardToken.sol";
import "../lib/SafeMath.sol";


contract DummyToken is StandardToken {
  using SafeMath for uint256;

  function DummyToken(string _name, string _symbol) public {
    name = _name;
    decimals = 18;
    symbol = _symbol;

    // mint some token for sender
    mintTokens(msg.sender, 1000 * (10 ** uint256(decimals)));
  }

  function mintTokens(address user, uint256 value) internal {
    balances[user] = balances[user].add(value);
    totalSupply = totalSupply.add(value);
  }
}
