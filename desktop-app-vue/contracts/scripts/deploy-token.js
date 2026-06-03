/**
 * 部署 ERC-20 代币合约脚本
 *
 * 用法:
 * npx hardhat run scripts/deploy-token.js --network sepolia
 * npx hardhat run scripts/deploy-token.js --network mumbai
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying ChainlessToken with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 代币参数
  const TOKEN_NAME = "ChainlessChain Token";
  const TOKEN_SYMBOL = "CCT";
  const DECIMALS = 18;
  const INITIAL_SUPPLY = hre.ethers.parseEther("1000000"); // 1,000,000 tokens

  console.log("\nDeploying ChainlessToken...");
  console.log("Parameters:");
  console.log("  Name:", TOKEN_NAME);
  console.log("  Symbol:", TOKEN_SYMBOL);
  console.log("  Decimals:", DECIMALS);
  console.log("  Initial Supply:", hre.ethers.formatEther(INITIAL_SUPPLY), "tokens");

  const ChainlessToken = await hre.ethers.getContractFactory("ChainlessToken");
  const token = await ChainlessToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, DECIMALS, INITIAL_SUPPLY);

  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();

  console.log("\n✅ ChainlessToken deployed to:", tokenAddress);
  console.log("Transaction hash:", token.deploymentTransaction().hash);
  console.log("Deployer balance after deployment:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 等待几个区块确认后再验证合约（如果在测试网）
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\nWaiting for block confirmations...");
    await token.deploymentTransaction().wait(5);

    console.log("\nVerifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: tokenAddress,
        constructorArguments: [TOKEN_NAME, TOKEN_SYMBOL, DECIMALS, INITIAL_SUPPLY],
      });
      console.log("✅ Contract verified on Etherscan");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
    }
  }

  // 保存部署信息
  const deployment = {
    network: hre.network.name,
    contractName: "ChainlessToken",
    address: tokenAddress,
    deployer: deployer.address,
    constructorArgs: {
      name: TOKEN_NAME,
      symbol: TOKEN_SYMBOL,
      decimals: DECIMALS,
      initialSupply: INITIAL_SUPPLY.toString(),
    },
    timestamp: new Date().toISOString(),
    txHash: token.deploymentTransaction().hash,
  };

  console.log("\nDeployment Info:", JSON.stringify(deployment, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
