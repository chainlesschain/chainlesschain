// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AssetBridge
 * @dev 跨链桥合约，用于在不同链之间转移资产
 *
 * 特性:
 * - 锁定-铸造模式（Lock-Mint）
 * - 支持 ERC20 代币跨链
 * - 桥接请求和完成记录
 * - 所有者权限控制（用于铸造）
 *
 * ⚠️ 注意：这是一个简化版本，生产环境建议使用 Chainlink CCIP 或 LayerZero
 *
 * 工作流程:
 * 1. 源链：用户锁定代币到桥合约
 * 2. 中继者监听锁定事件
 * 3. 目标链：中继者调用铸造函数，铸造等量代币给用户
 * 4. 反向：用户在目标链销毁代币，源链释放
 */
contract AssetBridge is Ownable, ReentrancyGuard {
    enum BridgeStatus { Pending, Completed, Cancelled }

    struct BridgeRequest {
        bytes32 id;
        address user;
        address token;
        uint256 amount;
        uint256 targetChainId;
        BridgeStatus status;
        uint256 createdAt;
        uint256 completedAt;
    }

    // 锁定的代币余额: token => amount
    mapping(address => uint256) public lockedBalances;

    // 桥接请求: requestId => BridgeRequest
    mapping(bytes32 => BridgeRequest) public bridgeRequests;

    // 已完成的桥接请求（防止重复铸造）
    mapping(bytes32 => bool) public completedBridges;

    // 中继者地址（可以多个）
    mapping(address => bool) public relayers;

    // 事件
    event AssetLocked(
        bytes32 indexed requestId,
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 targetChainId
    );

    event AssetMinted(
        bytes32 indexed requestId,
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 sourceChainId
    );

    event AssetBurned(
        bytes32 indexed requestId,
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 targetChainId
    );

    event AssetReleased(
        bytes32 indexed requestId,
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 sourceChainId
    );

    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);

    modifier onlyRelayer() {
        require(relayers[msg.sender] || msg.sender == owner(), "Not a relayer");
        _;
    }

    constructor() Ownable(msg.sender) {
        // 默认将部署者设为中继者
        relayers[msg.sender] = true;
    }

    /**
     * @dev 添加中继者
     * @param relayer 中继者地址
     */
    function addRelayer(address relayer) external onlyOwner {
        require(relayer != address(0), "Invalid relayer address");
        relayers[relayer] = true;
        emit RelayerAdded(relayer);
    }

    /**
     * @dev 移除中继者
     * @param relayer 中继者地址
     */
    function removeRelayer(address relayer) external onlyOwner {
        relayers[relayer] = false;
        emit RelayerRemoved(relayer);
    }

    /**
     * @dev 锁定代币（源链操作）
     * @param token 代币地址
     * @param amount 锁定数量
     * @param targetChainId 目标链 ID
     * @return requestId 桥接请求 ID
     */
    function lockAsset(
        address token,
        uint256 amount,
        uint256 targetChainId
    ) external nonReentrant returns (bytes32) {
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be greater than 0");
        require(targetChainId != block.chainid, "Cannot bridge to same chain");

        // 生成请求 ID
        bytes32 requestId = keccak256(
            abi.encodePacked(
                msg.sender,
                token,
                amount,
                targetChainId,
                block.timestamp,
                block.number
            )
        );

        // 转移代币到合约
        IERC20(token).transferFrom(msg.sender, address(this), amount);

        // 更新锁定余额
        lockedBalances[token] += amount;

        // 保存桥接请求
        bridgeRequests[requestId] = BridgeRequest({
            id: requestId,
            user: msg.sender,
            token: token,
            amount: amount,
            targetChainId: targetChainId,
            status: BridgeStatus.Pending,
            createdAt: block.timestamp,
            completedAt: 0
        });

        emit AssetLocked(requestId, msg.sender, token, amount, targetChainId);

        return requestId;
    }

    /**
     * @dev 铸造代币（目标链操作，仅中继者）
     * @param requestId 桥接请求 ID（来自源链）
     * @param user 接收地址
     * @param token 代币地址
     * @param amount 铸造数量
     * @param sourceChainId 源链 ID
     */
    function mintAsset(
        bytes32 requestId,
        address user,
        address token,
        uint256 amount,
        uint256 sourceChainId
    ) external onlyRelayer nonReentrant {
        require(user != address(0), "Invalid user address");
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be greater than 0");
        require(!completedBridges[requestId], "Bridge already completed");

        // 标记为已完成（防止重复铸造）
        completedBridges[requestId] = true;

        // 转移代币给用户（假设合约有足够的代币）
        IERC20(token).transfer(user, amount);

        emit AssetMinted(requestId, user, token, amount, sourceChainId);
    }

    /**
     * @dev 销毁代币（目标链操作，用于桥回源链）
     * @param token 代币地址
     * @param amount 销毁数量
     * @param targetChainId 目标链 ID（源链）
     * @return requestId 桥接请求 ID
     */
    function burnAsset(
        address token,
        uint256 amount,
        uint256 targetChainId
    ) external nonReentrant returns (bytes32) {
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be greater than 0");
        require(targetChainId != block.chainid, "Cannot bridge to same chain");

        // 生成请求 ID
        bytes32 requestId = keccak256(
            abi.encodePacked(
                msg.sender,
                token,
                amount,
                targetChainId,
                block.timestamp,
                block.number
            )
        );

        // 转移代币到合约（将被销毁）
        IERC20(token).transferFrom(msg.sender, address(this), amount);

        // 保存桥接请求
        bridgeRequests[requestId] = BridgeRequest({
            id: requestId,
            user: msg.sender,
            token: token,
            amount: amount,
            targetChainId: targetChainId,
            status: BridgeStatus.Pending,
            createdAt: block.timestamp,
            completedAt: 0
        });

        emit AssetBurned(requestId, msg.sender, token, amount, targetChainId);

        return requestId;
    }

    /**
     * @dev 释放代币（源链操作，仅中继者）
     * @param requestId 桥接请求 ID（来自目标链）
     * @param user 接收地址
     * @param token 代币地址
     * @param amount 释放数量
     * @param sourceChainId 源链 ID
     */
    function releaseAsset(
        bytes32 requestId,
        address user,
        address token,
        uint256 amount,
        uint256 sourceChainId
    ) external onlyRelayer nonReentrant {
        require(user != address(0), "Invalid user address");
        require(token != address(0), "Invalid token address");
        require(amount > 0, "Amount must be greater than 0");
        require(!completedBridges[requestId], "Bridge already completed");
        require(lockedBalances[token] >= amount, "Insufficient locked balance");

        // 标记为已完成
        completedBridges[requestId] = true;

        // 更新锁定余额
        lockedBalances[token] -= amount;

        // 转移代币给用户
        IERC20(token).transfer(user, amount);

        emit AssetReleased(requestId, user, token, amount, sourceChainId);
    }

    /**
     * @dev 获取桥接请求详情
     * @param requestId 请求 ID
     */
    function getBridgeRequest(bytes32 requestId) external view returns (BridgeRequest memory) {
        return bridgeRequests[requestId];
    }

    /**
     * @dev 检查桥接请求是否已完成
     * @param requestId 请求 ID
     */
    function isBridgeCompleted(bytes32 requestId) external view returns (bool) {
        return completedBridges[requestId];
    }

    /**
     * @dev 获取代币的锁定余额
     * @param token 代币地址
     */
    function getLockedBalance(address token) external view returns (uint256) {
        return lockedBalances[token];
    }

    /**
     * @dev 检查地址是否为中继者
     * @param account 地址
     */
    function isRelayer(address account) external view returns (bool) {
        return relayers[account];
    }

    /**
     * @dev 紧急提现（仅所有者）
     * ⚠️ 仅用于紧急情况
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }
}
