/**
 * 部署托管合约脚本
 *
 * 用法:
 * npx hardhat run scripts/deploy-escrow.js --network sepolia
 * npx hardhat run scripts/deploy-escrow.js --network mumbai
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying EscrowContract with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  console.log("\nDeploying EscrowContract...");

  const EscrowContract = await hre.ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowContract.deploy();

  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();

  console.log("\n✅ EscrowContract deployed to:", escrowAddress);
  console.log("Transaction hash:", escrow.deploymentTransaction().hash);
  console.log("Deployer balance after deployment:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 等待几个区块确认后再验证合约
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\nWaiting for block confirmations...");
    await escrow.deploymentTransaction().wait(5);

    console.log("\nVerifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: escrowAddress,
        constructorArguments: [],
      });
      console.log("✅ Contract verified on Etherscan");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
    }
  }

  // 保存部署信息
  const deployment = {
    network: hre.network.name,
    contractName: "EscrowContract",
    address: escrowAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    txHash: escrow.deploymentTransaction().hash,
  };

  console.log("\nDeployment Info:", JSON.stringify(deployment, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
