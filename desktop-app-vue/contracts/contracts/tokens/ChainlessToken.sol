// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ChainlessToken
 * @dev ERC20 代币合约，支持自定义小数位和铸币功能
 *
 * 特性:
 * - 自定义代币名称、符号和小数位
 * - 初始供应量在部署时铸造给合约创建者
 * - 所有者可以铸造额外的代币
 * - 遵循 ERC20 标准
 */
contract ChainlessToken is ERC20, Ownable {
    uint8 private _decimals;

    /**
     * @dev 构造函数
     * @param name 代币名称
     * @param symbol 代币符号
     * @param decimals_ 小数位数（通常为 18）
     * @param initialSupply 初始供应量（单位：最小单位，例如 wei）
     */
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        require(decimals_ > 0 && decimals_ <= 18, "Invalid decimals");
        _decimals = decimals_;
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev 返回代币的小数位数
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev 铸造新代币（仅限合约所有者）
     * @param to 接收地址
     * @param amount 铸造数量
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev 销毁代币
     * @param amount 销毁数量
     */
    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    /**
     * @dev 从指定地址销毁代币
     * @param from 销毁地址
     * @param amount 销毁数量
     */
    function burnFrom(address from, uint256 amount) public {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }
}
