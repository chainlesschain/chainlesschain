// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BountyContract
 * @dev 悬赏合约，用于任务发布、申领和奖金分配
 *
 * 特性:
 * - 发布悬赏任务
 * - 支持 ETH/MATIC 和 ERC20 代币奖励
 * - 任务申领和提交
 * - 任务审核和奖金发放
 * - 支持多人完成（奖金分割）
 * - 任务取消和退款
 */
contract BountyContract is ReentrancyGuard {
    enum PaymentType { Native, ERC20 }
    enum BountyStatus { Open, InProgress, Completed, Cancelled }
    enum SubmissionStatus { Pending, Approved, Rejected }

    struct Bounty {
        uint256 id;
        address issuer;
        string title;
        string description;
        uint256 reward;
        PaymentType paymentType;
        address tokenAddress;
        uint256 deadline;
        BountyStatus status;
        uint256 maxCompletions;  // 最多允许几人完成
        uint256 completedCount;
        uint256 createdAt;
    }

    struct Submission {
        uint256 bountyId;
        address hunter;
        string submissionData;  // IPFS 哈希或其他数据
        SubmissionStatus status;
        uint256 submittedAt;
        uint256 reviewedAt;
    }

    // 悬赏 ID 计数器
    uint256 private _bountyIdCounter;

    // 悬赏列表
    mapping(uint256 => Bounty) public bounties;

    // 提交记录: bountyId => hunter => Submission
    mapping(uint256 => mapping(address => Submission)) public submissions;

    // 悬赏的所有提交者
    mapping(uint256 => address[]) public bountyHunters;

    // 事件
    event BountyCreated(uint256 indexed bountyId, address indexed issuer, uint256 reward, uint256 deadline);
    event BountyClaimed(uint256 indexed bountyId, address indexed hunter);
    event SubmissionMade(uint256 indexed bountyId, address indexed hunter, string submissionData);
    event SubmissionApproved(uint256 indexed bountyId, address indexed hunter, uint256 reward);
    event SubmissionRejected(uint256 indexed bountyId, address indexed hunter);
    event BountyCancelled(uint256 indexed bountyId);
    event BountyCompleted(uint256 indexed bountyId);

    /**
     * @dev 创建悬赏任务（原生币）
     * @param title 任务标题
     * @param description 任务描述
     * @param deadline 截止时间（Unix 时间戳）
     * @param maxCompletions 最多允许几人完成
     */
    function createNativeBounty(
        string memory title,
        string memory description,
        uint256 deadline,
        uint256 maxCompletions
    ) external payable returns (uint256) {
        require(msg.value > 0, "Reward must be greater than 0");
        require(deadline > block.timestamp, "Deadline must be in the future");
        require(maxCompletions > 0, "Max completions must be greater than 0");

        uint256 bountyId = _bountyIdCounter++;

        bounties[bountyId] = Bounty({
            id: bountyId,
            issuer: msg.sender,
            title: title,
            description: description,
            reward: msg.value,
            paymentType: PaymentType.Native,
            tokenAddress: address(0),
            deadline: deadline,
            status: BountyStatus.Open,
            maxCompletions: maxCompletions,
            completedCount: 0,
            createdAt: block.timestamp
        });

        emit BountyCreated(bountyId, msg.sender, msg.value, deadline);
        return bountyId;
    }

    /**
     * @dev 创建悬赏任务（ERC20 代币）
     * @param title 任务标题
     * @param description 任务描述
     * @param reward 奖励金额
     * @param tokenAddress 代币地址
     * @param deadline 截止时间
     * @param maxCompletions 最多允许几人完成
     */
    function createERC20Bounty(
        string memory title,
        string memory description,
        uint256 reward,
        address tokenAddress,
        uint256 deadline,
        uint256 maxCompletions
    ) external returns (uint256) {
        require(reward > 0, "Reward must be greater than 0");
        require(tokenAddress != address(0), "Invalid token address");
        require(deadline > block.timestamp, "Deadline must be in the future");
        require(maxCompletions > 0, "Max completions must be greater than 0");

        // 转移代币到合约
        IERC20 token = IERC20(tokenAddress);
        require(token.transferFrom(msg.sender, address(this), reward), "Token transfer failed");

        uint256 bountyId = _bountyIdCounter++;

        bounties[bountyId] = Bounty({
            id: bountyId,
            issuer: msg.sender,
            title: title,
            description: description,
            reward: reward,
            paymentType: PaymentType.ERC20,
            tokenAddress: tokenAddress,
            deadline: deadline,
            status: BountyStatus.Open,
            maxCompletions: maxCompletions,
            completedCount: 0,
            createdAt: block.timestamp
        });

        emit BountyCreated(bountyId, msg.sender, reward, deadline);
        return bountyId;
    }

    /**
     * @dev 申领悬赏任务
     * @param bountyId 悬赏 ID
     */
    function claimBounty(uint256 bountyId) external {
        Bounty storage bounty = bounties[bountyId];
        require(bounty.status == BountyStatus.Open, "Bounty is not open");
        require(block.timestamp < bounty.deadline, "Bounty has expired");
        require(submissions[bountyId][msg.sender].hunter == address(0), "Already claimed");

        submissions[bountyId][msg.sender] = Submission({
            bountyId: bountyId,
            hunter: msg.sender,
            submissionData: "",
            status: SubmissionStatus.Pending,
            submittedAt: 0,
            reviewedAt: 0
        });

        bountyHunters[bountyId].push(msg.sender);

        if (bounty.status == BountyStatus.Open) {
            bounty.status = BountyStatus.InProgress;
        }

        emit BountyClaimed(bountyId, msg.sender);
    }

    /**
     * @dev 提交任务成果
     * @param bountyId 悬赏 ID
     * @param submissionData 提交数据（IPFS 哈希等）
     */
    function submitWork(uint256 bountyId, string memory submissionData) external {
        Bounty storage bounty = bounties[bountyId];
        Submission storage submission = submissions[bountyId][msg.sender];

        require(submission.hunter == msg.sender, "Not a hunter");
        require(submission.status == SubmissionStatus.Pending, "Already submitted");
        require(bounty.status == BountyStatus.InProgress, "Bounty is not in progress");
        require(block.timestamp < bounty.deadline, "Bounty has expired");

        submission.submissionData = submissionData;
        submission.submittedAt = block.timestamp;

        emit SubmissionMade(bountyId, msg.sender, submissionData);
    }

    /**
     * @dev 批准提交并发放奖金
     * @param bountyId 悬赏 ID
     * @param hunter 猎人地址
     */
    function approveSubmission(uint256 bountyId, address hunter) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        Submission storage submission = submissions[bountyId][hunter];

        require(bounty.issuer == msg.sender, "Only issuer can approve");
        require(submission.status == SubmissionStatus.Pending, "Invalid status");
        require(submission.submittedAt > 0, "No submission");
        require(bounty.completedCount < bounty.maxCompletions, "Max completions reached");

        submission.status = SubmissionStatus.Approved;
        submission.reviewedAt = block.timestamp;

        bounty.completedCount++;

        // 计算奖金（平均分配）
        uint256 rewardPerPerson = bounty.reward / bounty.maxCompletions;

        // 发放奖金
        if (bounty.paymentType == PaymentType.Native) {
            payable(hunter).transfer(rewardPerPerson);
        } else {
            IERC20 token = IERC20(bounty.tokenAddress);
            require(token.transfer(hunter, rewardPerPerson), "Token transfer failed");
        }

        emit SubmissionApproved(bountyId, hunter, rewardPerPerson);

        // 如果所有名额都已完成，标记悬赏为已完成
        if (bounty.completedCount >= bounty.maxCompletions) {
            bounty.status = BountyStatus.Completed;
            emit BountyCompleted(bountyId);
        }
    }

    /**
     * @dev 拒绝提交
     * @param bountyId 悬赏 ID
     * @param hunter 猎人地址
     */
    function rejectSubmission(uint256 bountyId, address hunter) external {
        Bounty storage bounty = bounties[bountyId];
        Submission storage submission = submissions[bountyId][hunter];

        require(bounty.issuer == msg.sender, "Only issuer can reject");
        require(submission.status == SubmissionStatus.Pending, "Invalid status");
        require(submission.submittedAt > 0, "No submission");

        submission.status = SubmissionStatus.Rejected;
        submission.reviewedAt = block.timestamp;

        emit SubmissionRejected(bountyId, hunter);
    }

    /**
     * @dev 取消悬赏并退款
     * @param bountyId 悬赏 ID
     */
    function cancelBounty(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];

        require(bounty.issuer == msg.sender, "Only issuer can cancel");
        require(
            bounty.status == BountyStatus.Open || bounty.status == BountyStatus.InProgress,
            "Cannot cancel"
        );

        bounty.status = BountyStatus.Cancelled;

        // 退款未使用的奖金
        uint256 usedReward = bounty.completedCount * (bounty.reward / bounty.maxCompletions);
        uint256 refund = bounty.reward - usedReward;

        if (refund > 0) {
            if (bounty.paymentType == PaymentType.Native) {
                payable(bounty.issuer).transfer(refund);
            } else {
                IERC20 token = IERC20(bounty.tokenAddress);
                require(token.transfer(bounty.issuer, refund), "Token transfer failed");
            }
        }

        emit BountyCancelled(bountyId);
    }

    /**
     * @dev 获取悬赏详情
     * @param bountyId 悬赏 ID
     */
    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    /**
     * @dev 获取提交详情
     * @param bountyId 悬赏 ID
     * @param hunter 猎人地址
     */
    function getSubmission(uint256 bountyId, address hunter) external view returns (Submission memory) {
        return submissions[bountyId][hunter];
    }

    /**
     * @dev 获取悬赏的所有猎人
     * @param bountyId 悬赏 ID
     */
    function getBountyHunters(uint256 bountyId) external view returns (address[] memory) {
        return bountyHunters[bountyId];
    }

    /**
     * @dev 获取下一个悬赏 ID
     */
    function nextBountyId() external view returns (uint256) {
        return _bountyIdCounter;
    }
}
