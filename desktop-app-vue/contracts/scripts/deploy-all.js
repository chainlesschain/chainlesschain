/**
 * 部署所有合约脚本
 *
 * 用法:
 * npx hardhat run scripts/deploy-all.js --network sepolia
 * npx hardhat run scripts/deploy-all.js --network mumbai
 * npx hardhat run scripts/deploy-all.js --network localhost
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("=".repeat(60));
  console.log("Deploying All ChainlessChain Contracts");
  console.log("=".repeat(60));
  console.log("\nNetwork:", hre.network.name);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");

  const deployments = {};

  // 1. 部署 ERC-20 代币合约
  console.log("\n[1/6] Deploying ChainlessToken...");
  const ChainlessToken = await hre.ethers.getContractFactory("ChainlessToken");
  const token = await ChainlessToken.deploy(
    "ChainlessChain Token",
    "CCT",
    18,
    hre.ethers.parseEther("1000000")
  );
  await token.waitForDeployment();
  deployments.token = await token.getAddress();
  console.log("✅ ChainlessToken deployed to:", deployments.token);

  // 2. 部署 ERC-721 NFT 合约
  console.log("\n[2/6] Deploying ChainlessNFT...");
  const ChainlessNFT = await hre.ethers.getContractFactory("ChainlessNFT");
  const nft = await ChainlessNFT.deploy("ChainlessChain NFT", "CCNFT");
  await nft.waitForDeployment();
  deployments.nft = await nft.getAddress();
  console.log("✅ ChainlessNFT deployed to:", deployments.nft);

  // 3. 部署托管合约
  console.log("\n[3/6] Deploying EscrowContract...");
  const EscrowContract = await hre.ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowContract.deploy();
  await escrow.waitForDeployment();
  deployments.escrow = await escrow.getAddress();
  console.log("✅ EscrowContract deployed to:", deployments.escrow);

  // 4. 部署订阅合约
  console.log("\n[4/6] Deploying SubscriptionContract...");
  const SubscriptionContract = await hre.ethers.getContractFactory("SubscriptionContract");
  const subscription = await SubscriptionContract.deploy();
  await subscription.waitForDeployment();
  deployments.subscription = await subscription.getAddress();
  console.log("✅ SubscriptionContract deployed to:", deployments.subscription);

  // 5. 部署悬赏合约
  console.log("\n[5/6] Deploying BountyContract...");
  const BountyContract = await hre.ethers.getContractFactory("BountyContract");
  const bounty = await BountyContract.deploy();
  await bounty.waitForDeployment();
  deployments.bounty = await bounty.getAddress();
  console.log("✅ BountyContract deployed to:", deployments.bounty);

  // 6. 部署跨链桥合约
  console.log("\n[6/6] Deploying AssetBridge...");
  const AssetBridge = await hre.ethers.getContractFactory("AssetBridge");
  const bridge = await AssetBridge.deploy();
  await bridge.waitForDeployment();
  deployments.bridge = await bridge.getAddress();
  console.log("✅ AssetBridge deployed to:", deployments.bridge);

  console.log("\n" + "=".repeat(60));
  console.log("Deployment Summary");
  console.log("=".repeat(60));
  console.log("\nAll contracts deployed successfully!");
  console.log("\nContract Addresses:");
  console.log("  ChainlessToken:        ", deployments.token);
  console.log("  ChainlessNFT:          ", deployments.nft);
  console.log("  EscrowContract:        ", deployments.escrow);
  console.log("  SubscriptionContract:  ", deployments.subscription);
  console.log("  BountyContract:        ", deployments.bounty);
  console.log("  AssetBridge:           ", deployments.bridge);

  console.log("\nDeployer balance after deployment:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  // 保存部署信息到文件
  const deploymentData = {
    network: hre.network.name,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ChainlessToken: {
        address: deployments.token,
        constructorArgs: ["ChainlessChain Token", "CCT", 18, hre.ethers.parseEther("1000000").toString()],
      },
      ChainlessNFT: {
        address: deployments.nft,
        constructorArgs: ["ChainlessChain NFT", "CCNFT"],
      },
      EscrowContract: {
        address: deployments.escrow,
        constructorArgs: [],
      },
      SubscriptionContract: {
        address: deployments.subscription,
        constructorArgs: [],
      },
      BountyContract: {
        address: deployments.bounty,
        constructorArgs: [],
      },
      AssetBridge: {
        address: deployments.bridge,
        constructorArgs: [],
      },
    },
  };

  const deploymentFile = path.join(__dirname, `../deployments/${hre.network.name}.json`);
  const deploymentDir = path.dirname(deploymentFile);

  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
  console.log("\n✅ Deployment data saved to:", deploymentFile);

  // 验证合约（如果在测试网）
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\n" + "=".repeat(60));
    console.log("Verifying Contracts on Etherscan");
    console.log("=".repeat(60));
    console.log("\nWaiting for block confirmations...");

    // 等待5个区块确认
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log("\nVerifying contracts...");

    try {
      await hre.run("verify:verify", {
        address: deployments.token,
        constructorArguments: ["ChainlessChain Token", "CCT", 18, hre.ethers.parseEther("1000000")],
      });
      console.log("✅ ChainlessToken verified");
    } catch (error) {
      console.log("❌ ChainlessToken verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: deployments.nft,
        constructorArguments: ["ChainlessChain NFT", "CCNFT"],
      });
      console.log("✅ ChainlessNFT verified");
    } catch (error) {
      console.log("❌ ChainlessNFT verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: deployments.escrow,
        constructorArguments: [],
      });
      console.log("✅ EscrowContract verified");
    } catch (error) {
      console.log("❌ EscrowContract verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: deployments.subscription,
        constructorArguments: [],
      });
      console.log("✅ SubscriptionContract verified");
    } catch (error) {
      console.log("❌ SubscriptionContract verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: deployments.bounty,
        constructorArguments: [],
      });
      console.log("✅ BountyContract verified");
    } catch (error) {
      console.log("❌ BountyContract verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: deployments.bridge,
        constructorArguments: [],
      });
      console.log("✅ AssetBridge verified");
    } catch (error) {
      console.log("❌ AssetBridge verification failed:", error.message);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Deployment Complete!");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
