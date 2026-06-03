// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SubscriptionContract
 * @dev 订阅合约，用于知识付费、内容订阅等场景
 *
 * 特性:
 * - 创建订阅计划（按月/按年）
 * - 支持 ETH/MATIC 原生币和 ERC20 代币支付
 * - 自动续订机制
 * - 订阅者管理
 * - 订阅历史记录
 */
contract SubscriptionContract is Ownable, ReentrancyGuard {
    enum PaymentType { Native, ERC20 }
    enum SubscriptionPeriod { Monthly, Quarterly, Yearly }

    struct Plan {
        uint256 id;
        string name;
        string description;
        uint256 price;
        PaymentType paymentType;
        address tokenAddress;
        SubscriptionPeriod period;
        bool active;
        uint256 createdAt;
    }

    struct Subscription {
        uint256 planId;
        address subscriber;
        uint256 startTime;
        uint256 endTime;
        bool active;
        bool autoRenew;
    }

    // 计划 ID 计数器
    uint256 private _planIdCounter;

    // 计划列表
    mapping(uint256 => Plan) public plans;

    // 订阅记录: subscriber => planId => Subscription
    mapping(address => mapping(uint256 => Subscription)) public subscriptions;

    // 所有订阅者列表（按计划）
    mapping(uint256 => address[]) public planSubscribers;

    // 事件
    event PlanCreated(uint256 indexed planId, string name, uint256 price, SubscriptionPeriod period);
    event PlanUpdated(uint256 indexed planId, uint256 newPrice, bool active);
    event Subscribed(uint256 indexed planId, address indexed subscriber, uint256 endTime);
    event SubscriptionRenewed(uint256 indexed planId, address indexed subscriber, uint256 newEndTime);
    event SubscriptionCancelled(uint256 indexed planId, address indexed subscriber);
    event PaymentReceived(uint256 indexed planId, address indexed subscriber, uint256 amount);

    constructor() Ownable(msg.sender) {
        _planIdCounter = 0;
    }

    /**
     * @dev 创建订阅计划（原生币）
     * @param name 计划名称
     * @param description 计划描述
     * @param price 价格（单位：Wei）
     * @param period 订阅周期
     */
    function createNativePlan(
        string memory name,
        string memory description,
        uint256 price,
        SubscriptionPeriod period
    ) external onlyOwner returns (uint256) {
        require(price > 0, "Price must be greater than 0");

        uint256 planId = _planIdCounter++;

        plans[planId] = Plan({
            id: planId,
            name: name,
            description: description,
            price: price,
            paymentType: PaymentType.Native,
            tokenAddress: address(0),
            period: period,
            active: true,
            createdAt: block.timestamp
        });

        emit PlanCreated(planId, name, price, period);
        return planId;
    }

    /**
     * @dev 创建订阅计划（ERC20 代币）
     * @param name 计划名称
     * @param description 计划描述
     * @param price 价格
     * @param tokenAddress 代币地址
     * @param period 订阅周期
     */
    function createERC20Plan(
        string memory name,
        string memory description,
        uint256 price,
        address tokenAddress,
        SubscriptionPeriod period
    ) external onlyOwner returns (uint256) {
        require(price > 0, "Price must be greater than 0");
        require(tokenAddress != address(0), "Invalid token address");

        uint256 planId = _planIdCounter++;

        plans[planId] = Plan({
            id: planId,
            name: name,
            description: description,
            price: price,
            paymentType: PaymentType.ERC20,
            tokenAddress: tokenAddress,
            period: period,
            active: true,
            createdAt: block.timestamp
        });

        emit PlanCreated(planId, name, price, period);
        return planId;
    }

    /**
     * @dev 更新订阅计划
     * @param planId 计划 ID
     * @param newPrice 新价格
     * @param active 是否激活
     */
    function updatePlan(uint256 planId, uint256 newPrice, bool active) external onlyOwner {
        Plan storage plan = plans[planId];
        require(plan.id == planId, "Plan does not exist");

        plan.price = newPrice;
        plan.active = active;

        emit PlanUpdated(planId, newPrice, active);
    }

    /**
     * @dev 订阅计划（原生币支付）
     * @param planId 计划 ID
     * @param autoRenew 是否自动续订
     */
    function subscribe(uint256 planId, bool autoRenew) external payable nonReentrant {
        Plan storage plan = plans[planId];
        require(plan.active, "Plan is not active");
        require(plan.paymentType == PaymentType.Native, "This plan requires ERC20 payment");
        require(msg.value == plan.price, "Incorrect payment amount");

        _createOrRenewSubscription(planId, msg.sender, autoRenew);

        // 转账给合约所有者
        payable(owner()).transfer(msg.value);

        emit PaymentReceived(planId, msg.sender, msg.value);
    }

    /**
     * @dev 订阅计划（ERC20 代币支付）
     * @param planId 计划 ID
     * @param autoRenew 是否自动续订
     */
    function subscribeWithToken(uint256 planId, bool autoRenew) external nonReentrant {
        Plan storage plan = plans[planId];
        require(plan.active, "Plan is not active");
        require(plan.paymentType == PaymentType.ERC20, "This plan requires native payment");

        // 转移代币
        IERC20 token = IERC20(plan.tokenAddress);
        require(token.transferFrom(msg.sender, owner(), plan.price), "Token transfer failed");

        _createOrRenewSubscription(planId, msg.sender, autoRenew);

        emit PaymentReceived(planId, msg.sender, plan.price);
    }

    /**
     * @dev 内部函数：创建或续订订阅
     */
    function _createOrRenewSubscription(uint256 planId, address subscriber, bool autoRenew) private {
        Plan storage plan = plans[planId];
        Subscription storage sub = subscriptions[subscriber][planId];

        uint256 duration = _getPeriodDuration(plan.period);
        uint256 newEndTime;

        if (sub.subscriber == address(0)) {
            // 新订阅
            newEndTime = block.timestamp + duration;
            sub.planId = planId;
            sub.subscriber = subscriber;
            sub.startTime = block.timestamp;
            sub.endTime = newEndTime;
            sub.active = true;
            sub.autoRenew = autoRenew;

            planSubscribers[planId].push(subscriber);

            emit Subscribed(planId, subscriber, newEndTime);
        } else {
            // 续订
            if (sub.endTime > block.timestamp) {
                // 还在订阅期内，从当前结束时间续订
                newEndTime = sub.endTime + duration;
            } else {
                // 订阅已过期，从当前时间续订
                newEndTime = block.timestamp + duration;
            }

            sub.endTime = newEndTime;
            sub.active = true;
            sub.autoRenew = autoRenew;

            emit SubscriptionRenewed(planId, subscriber, newEndTime);
        }
    }

    /**
     * @dev 取消订阅
     * @param planId 计划 ID
     */
    function cancelSubscription(uint256 planId) external {
        Subscription storage sub = subscriptions[msg.sender][planId];
        require(sub.subscriber == msg.sender, "Subscription does not exist");

        sub.autoRenew = false;
        sub.active = false;

        emit SubscriptionCancelled(planId, msg.sender);
    }

    /**
     * @dev 检查订阅是否有效
     * @param subscriber 订阅者地址
     * @param planId 计划 ID
     */
    function isSubscriptionActive(address subscriber, uint256 planId) external view returns (bool) {
        Subscription storage sub = subscriptions[subscriber][planId];
        return sub.active && sub.endTime > block.timestamp;
    }

    /**
     * @dev 获取订阅详情
     * @param subscriber 订阅者地址
     * @param planId 计划 ID
     */
    function getSubscription(address subscriber, uint256 planId) external view returns (Subscription memory) {
        return subscriptions[subscriber][planId];
    }

    /**
     * @dev 获取计划的所有订阅者
     * @param planId 计划 ID
     */
    function getPlanSubscribers(uint256 planId) external view returns (address[] memory) {
        return planSubscribers[planId];
    }

    /**
     * @dev 获取订阅周期的时长（秒）
     */
    function _getPeriodDuration(SubscriptionPeriod period) private pure returns (uint256) {
        if (period == SubscriptionPeriod.Monthly) {
            return 30 days;
        } else if (period == SubscriptionPeriod.Quarterly) {
            return 90 days;
        } else if (period == SubscriptionPeriod.Yearly) {
            return 365 days;
        }
        return 0;
    }

    /**
     * @dev 获取下一个计划 ID
     */
    function nextPlanId() external view returns (uint256) {
        return _planIdCounter;
    }
}
