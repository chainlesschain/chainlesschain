// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title EscrowContract
 * @dev 托管合约，用于安全的买卖双方交易
 *
 * 特性:
 * - 支持 ETH/MATIC 原生币托管
 * - 支持 ERC20 代币托管
 * - 买家创建托管并锁定资金
 * - 买家确认后释放资金给卖家
 * - 支持退款机制
 * - 支持争议解决（仲裁者）
 * - 防重入攻击
 */
contract EscrowContract is ReentrancyGuard {
    enum State { Created, Funded, Delivered, Completed, Refunded, Disputed }
    enum PaymentType { Native, ERC20 }

    struct Escrow {
        bytes32 id;
        address buyer;
        address seller;
        address arbitrator;
        uint256 amount;
        PaymentType paymentType;
        address tokenAddress;  // ERC20 代币地址（如果使用 ERC20）
        State state;
        uint256 createdAt;
        uint256 completedAt;
    }

    // 托管记录
    mapping(bytes32 => Escrow) public escrows;

    // 事件
    event EscrowCreated(bytes32 indexed escrowId, address indexed buyer, address indexed seller, uint256 amount, PaymentType paymentType);
    event EscrowFunded(bytes32 indexed escrowId, uint256 amount);
    event EscrowDelivered(bytes32 indexed escrowId);
    event EscrowCompleted(bytes32 indexed escrowId, address indexed seller, uint256 amount);
    event EscrowRefunded(bytes32 indexed escrowId, address indexed buyer, uint256 amount);
    event EscrowDisputed(bytes32 indexed escrowId, address indexed initiator);
    event EscrowResolvedBySeller(bytes32 indexed escrowId, address indexed seller);
    event EscrowResolvedByBuyer(bytes32 indexed escrowId, address indexed buyer);

    /**
     * @dev 创建原生币托管（ETH/MATIC）
     * @param escrowId 托管 ID
     * @param seller 卖家地址
     * @param arbitrator 仲裁者地址（可选，地址为 0 表示无仲裁者）
     */
    function createNativeEscrow(
        bytes32 escrowId,
        address seller,
        address arbitrator
    ) external payable {
        require(msg.value > 0, "Amount must be greater than 0");
        require(escrows[escrowId].buyer == address(0), "Escrow already exists");
        require(seller != address(0), "Invalid seller address");
        require(seller != msg.sender, "Buyer and seller must be different");

        escrows[escrowId] = Escrow({
            id: escrowId,
            buyer: msg.sender,
            seller: seller,
            arbitrator: arbitrator,
            amount: msg.value,
            paymentType: PaymentType.Native,
            tokenAddress: address(0),
            state: State.Funded,
            createdAt: block.timestamp,
            completedAt: 0
        });

        emit EscrowCreated(escrowId, msg.sender, seller, msg.value, PaymentType.Native);
        emit EscrowFunded(escrowId, msg.value);
    }

    /**
     * @dev 创建 ERC20 代币托管
     * @param escrowId 托管 ID
     * @param seller 卖家地址
     * @param arbitrator 仲裁者地址（可选）
     * @param tokenAddress ERC20 代币地址
     * @param amount 代币数量
     */
    function createERC20Escrow(
        bytes32 escrowId,
        address seller,
        address arbitrator,
        address tokenAddress,
        uint256 amount
    ) external {
        require(amount > 0, "Amount must be greater than 0");
        require(escrows[escrowId].buyer == address(0), "Escrow already exists");
        require(seller != address(0), "Invalid seller address");
        require(seller != msg.sender, "Buyer and seller must be different");
        require(tokenAddress != address(0), "Invalid token address");

        // 转移代币到合约
        IERC20 token = IERC20(tokenAddress);
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");

        escrows[escrowId] = Escrow({
            id: escrowId,
            buyer: msg.sender,
            seller: seller,
            arbitrator: arbitrator,
            amount: amount,
            paymentType: PaymentType.ERC20,
            tokenAddress: tokenAddress,
            state: State.Funded,
            createdAt: block.timestamp,
            completedAt: 0
        });

        emit EscrowCreated(escrowId, msg.sender, seller, amount, PaymentType.ERC20);
        emit EscrowFunded(escrowId, amount);
    }

    /**
     * @dev 卖家标记已交付
     * @param escrowId 托管 ID
     */
    function markAsDelivered(bytes32 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.seller == msg.sender, "Only seller can mark as delivered");
        require(escrow.state == State.Funded, "Invalid state");

        escrow.state = State.Delivered;
        emit EscrowDelivered(escrowId);
    }

    /**
     * @dev 买家确认收货并释放资金
     * @param escrowId 托管 ID
     */
    function release(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.buyer == msg.sender, "Only buyer can release");
        require(escrow.state == State.Funded || escrow.state == State.Delivered, "Invalid state");

        escrow.state = State.Completed;
        escrow.completedAt = block.timestamp;

        // 转账给卖家
        if (escrow.paymentType == PaymentType.Native) {
            payable(escrow.seller).transfer(escrow.amount);
        } else {
            IERC20 token = IERC20(escrow.tokenAddress);
            require(token.transfer(escrow.seller, escrow.amount), "Token transfer failed");
        }

        emit EscrowCompleted(escrowId, escrow.seller, escrow.amount);
    }

    /**
     * @dev 退款给买家
     * @param escrowId 托管 ID
     */
    function refund(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(
            escrow.seller == msg.sender || escrow.buyer == msg.sender,
            "Only buyer or seller can refund"
        );
        require(escrow.state == State.Funded, "Invalid state");

        escrow.state = State.Refunded;
        escrow.completedAt = block.timestamp;

        // 退款给买家
        if (escrow.paymentType == PaymentType.Native) {
            payable(escrow.buyer).transfer(escrow.amount);
        } else {
            IERC20 token = IERC20(escrow.tokenAddress);
            require(token.transfer(escrow.buyer, escrow.amount), "Token transfer failed");
        }

        emit EscrowRefunded(escrowId, escrow.buyer, escrow.amount);
    }

    /**
     * @dev 发起争议
     * @param escrowId 托管 ID
     */
    function dispute(bytes32 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        require(
            escrow.buyer == msg.sender || escrow.seller == msg.sender,
            "Only buyer or seller can dispute"
        );
        require(escrow.state == State.Funded || escrow.state == State.Delivered, "Invalid state");
        require(escrow.arbitrator != address(0), "No arbitrator assigned");

        escrow.state = State.Disputed;
        emit EscrowDisputed(escrowId, msg.sender);
    }

    /**
     * @dev 仲裁者解决争议：释放给卖家
     * @param escrowId 托管 ID
     */
    function resolveDisputeToSeller(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.arbitrator == msg.sender, "Only arbitrator can resolve");
        require(escrow.state == State.Disputed, "Invalid state");

        escrow.state = State.Completed;
        escrow.completedAt = block.timestamp;

        // 转账给卖家
        if (escrow.paymentType == PaymentType.Native) {
            payable(escrow.seller).transfer(escrow.amount);
        } else {
            IERC20 token = IERC20(escrow.tokenAddress);
            require(token.transfer(escrow.seller, escrow.amount), "Token transfer failed");
        }

        emit EscrowResolvedBySeller(escrowId, escrow.seller);
    }

    /**
     * @dev 仲裁者解决争议：退款给买家
     * @param escrowId 托管 ID
     */
    function resolveDisputeToBuyer(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.arbitrator == msg.sender, "Only arbitrator can resolve");
        require(escrow.state == State.Disputed, "Invalid state");

        escrow.state = State.Refunded;
        escrow.completedAt = block.timestamp;

        // 退款给买家
        if (escrow.paymentType == PaymentType.Native) {
            payable(escrow.buyer).transfer(escrow.amount);
        } else {
            IERC20 token = IERC20(escrow.tokenAddress);
            require(token.transfer(escrow.buyer, escrow.amount), "Token transfer failed");
        }

        emit EscrowResolvedByBuyer(escrowId, escrow.buyer);
    }

    /**
     * @dev 获取托管详情
     * @param escrowId 托管 ID
     */
    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }
}
