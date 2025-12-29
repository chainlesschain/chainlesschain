const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract", function () {
  let escrow;
  let token;
  let buyer;
  let seller;
  let arbitrator;
  let addr1;

  const ESCROW_AMOUNT = ethers.parseEther("1.0");
  const TOKEN_AMOUNT = ethers.parseUnits("100", 18);

  beforeEach(async function () {
    [buyer, seller, arbitrator, addr1] = await ethers.getSigners();

    // Deploy Escrow Contract
    const EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy();

    // Deploy Test Token
    const ChainlessToken = await ethers.getContractFactory("ChainlessToken");
    token = await ChainlessToken.deploy("Test Token", "TEST", 18, ethers.parseEther("1000000"));

    // Transfer tokens to buyer for testing
    await token.transfer(buyer.address, TOKEN_AMOUNT);
  });

  describe("Native Escrow", function () {
    let escrowId;

    beforeEach(function () {
      escrowId = ethers.id("escrow-test-1");
    });

    it("Should create native escrow successfully", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.buyer).to.equal(buyer.address);
      expect(escrowData.seller).to.equal(seller.address);
      expect(escrowData.arbitrator).to.equal(arbitrator.address);
      expect(escrowData.amount).to.equal(ESCROW_AMOUNT);
      expect(escrowData.state).to.equal(1); // Funded
    });

    it("Should not allow creating escrow with zero value", async function () {
      await expect(
        escrow.connect(buyer).createNativeEscrow(
          escrowId,
          seller.address,
          arbitrator.address,
          { value: 0 }
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should not allow duplicate escrow IDs", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      await expect(
        escrow.connect(buyer).createNativeEscrow(
          escrowId,
          seller.address,
          arbitrator.address,
          { value: ESCROW_AMOUNT }
        )
      ).to.be.revertedWith("Escrow already exists");
    });

    it("Should allow seller to mark as delivered", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      await escrow.connect(seller).markAsDelivered(escrowId);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(2); // Delivered
    });

    it("Should release funds to seller after buyer confirmation", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      const initialBalance = await ethers.provider.getBalance(seller.address);

      await escrow.connect(buyer).release(escrowId);

      const finalBalance = await ethers.provider.getBalance(seller.address);
      expect(finalBalance - initialBalance).to.equal(ESCROW_AMOUNT);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(3); // Completed
    });

    it("Should allow refund", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      const initialBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await escrow.connect(seller).refund(escrowId);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const finalBalance = await ethers.provider.getBalance(buyer.address);
      // Buyer gets refund (no gas cost since seller called refund)
      expect(finalBalance - initialBalance).to.equal(ESCROW_AMOUNT);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(4); // Refunded
    });

    it("Should allow dispute", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      await escrow.connect(buyer).dispute(escrowId);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(5); // Disputed
    });

    it("Should allow arbitrator to resolve dispute in favor of seller", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      await escrow.connect(buyer).dispute(escrowId);

      const initialBalance = await ethers.provider.getBalance(seller.address);

      await escrow.connect(arbitrator).resolveDisputeToSeller(escrowId);

      const finalBalance = await ethers.provider.getBalance(seller.address);
      expect(finalBalance - initialBalance).to.equal(ESCROW_AMOUNT);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(3); // Completed
    });

    it("Should allow arbitrator to resolve dispute in favor of buyer", async function () {
      await escrow.connect(buyer).createNativeEscrow(
        escrowId,
        seller.address,
        arbitrator.address,
        { value: ESCROW_AMOUNT }
      );

      await escrow.connect(buyer).dispute(escrowId);

      const initialBalance = await ethers.provider.getBalance(buyer.address);

      const tx = await escrow.connect(arbitrator).resolveDisputeToBuyer(escrowId);
      const receipt = await tx.wait();

      const finalBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalBalance - initialBalance).to.equal(ESCROW_AMOUNT);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(4); // Refunded
    });
  });

  describe("ERC20 Escrow", function () {
    let escrowId;

    beforeEach(async function () {
      escrowId = ethers.id("escrow-erc20-1");

      // Approve escrow contract to spend buyer's tokens
      await token.connect(buyer).approve(escrow.target, TOKEN_AMOUNT);
    });

    it("Should create ERC20 escrow successfully", async function () {
      await escrow.connect(buyer).createERC20Escrow(
        escrowId,
        seller.address,
        arbitrator.address,
        token.target,
        TOKEN_AMOUNT
      );

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.buyer).to.equal(buyer.address);
      expect(escrowData.seller).to.equal(seller.address);
      expect(escrowData.amount).to.equal(TOKEN_AMOUNT);
      expect(escrowData.tokenAddress).to.equal(token.target);
      expect(escrowData.state).to.equal(1); // Funded
    });

    it("Should transfer tokens to escrow contract", async function () {
      const contractBalanceBefore = await token.balanceOf(escrow.target);

      await escrow.connect(buyer).createERC20Escrow(
        escrowId,
        seller.address,
        arbitrator.address,
        token.target,
        TOKEN_AMOUNT
      );

      const contractBalanceAfter = await token.balanceOf(escrow.target);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(TOKEN_AMOUNT);
    });

    it("Should release tokens to seller", async function () {
      await escrow.connect(buyer).createERC20Escrow(
        escrowId,
        seller.address,
        arbitrator.address,
        token.target,
        TOKEN_AMOUNT
      );

      const initialBalance = await token.balanceOf(seller.address);

      await escrow.connect(buyer).release(escrowId);

      const finalBalance = await token.balanceOf(seller.address);
      expect(finalBalance - initialBalance).to.equal(TOKEN_AMOUNT);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(3); // Completed
    });

    it("Should refund tokens to buyer", async function () {
      await escrow.connect(buyer).createERC20Escrow(
        escrowId,
        seller.address,
        arbitrator.address,
        token.target,
        TOKEN_AMOUNT
      );

      const initialBalance = await token.balanceOf(buyer.address);

      await escrow.connect(seller).refund(escrowId);

      const finalBalance = await token.balanceOf(buyer.address);
      expect(finalBalance - initialBalance).to.equal(TOKEN_AMOUNT);

      const escrowData = await escrow.getEscrow(escrowId);
      expect(escrowData.state).to.equal(4); // Refunded
    });
  });
});
