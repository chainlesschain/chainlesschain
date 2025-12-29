/**
 * 部署 ERC-721 NFT 合约脚本
 *
 * 用法:
 * npx hardhat run scripts/deploy-nft.js --network sepolia
 * npx hardhat run scripts/deploy-nft.js --network mumbai
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying ChainlessNFT with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // NFT 参数
  const NFT_NAME = "ChainlessChain NFT";
  const NFT_SYMBOL = "CCNFT";

  console.log("\nDeploying ChainlessNFT...");
  console.log("Parameters:");
  console.log("  Name:", NFT_NAME);
  console.log("  Symbol:", NFT_SYMBOL);

  const ChainlessNFT = await hre.ethers.getContractFactory("ChainlessNFT");
  const nft = await ChainlessNFT.deploy(NFT_NAME, NFT_SYMBOL);

  await nft.waitForDeployment();

  const nftAddress = await nft.getAddress();

  console.log("\n✅ ChainlessNFT deployed to:", nftAddress);
  console.log("Transaction hash:", nft.deploymentTransaction().hash);
  console.log("Deployer balance after deployment:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 等待几个区块确认后再验证合约
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\nWaiting for block confirmations...");
    await nft.deploymentTransaction().wait(5);

    console.log("\nVerifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: nftAddress,
        constructorArguments: [NFT_NAME, NFT_SYMBOL],
      });
      console.log("✅ Contract verified on Etherscan");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
    }
  }

  // 保存部署信息
  const deployment = {
    network: hre.network.name,
    contractName: "ChainlessNFT",
    address: nftAddress,
    deployer: deployer.address,
    constructorArgs: {
      name: NFT_NAME,
      symbol: NFT_SYMBOL,
    },
    timestamp: new Date().toISOString(),
    txHash: nft.deploymentTransaction().hash,
  };

  console.log("\nDeployment Info:", JSON.stringify(deployment, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
