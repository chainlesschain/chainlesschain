const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ChainlessToken", function () {
  let token;
  let owner;
  let addr1;
  let addr2;

  const TOKEN_NAME = "ChainlessChain Token";
  const TOKEN_SYMBOL = "CCT";
  const DECIMALS = 18;
  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1,000,000 tokens

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const ChainlessToken = await ethers.getContractFactory("ChainlessToken");
    token = await ChainlessToken.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      DECIMALS,
      INITIAL_SUPPLY
    );
  });

  describe("Deployment", function () {
    it("Should set the right token name and symbol", async function () {
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("Should set the right decimals", async function () {
      expect(await token.decimals()).to.equal(DECIMALS);
    });

    it("Should assign the total supply to the owner", async function () {
      const ownerBalance = await token.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY);
    });

    it("Should set the right owner", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });
  });

  describe("Transfers", function () {
    it("Should transfer tokens between accounts", async function () {
      const transferAmount = ethers.parseEther("100");

      await token.transfer(addr1.address, transferAmount);
      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);

      await token.connect(addr1).transfer(addr2.address, transferAmount);
      expect(await token.balanceOf(addr2.address)).to.equal(transferAmount);
      expect(await token.balanceOf(addr1.address)).to.equal(0);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);

      await expect(
        token.connect(addr1).transfer(owner.address, 1)
      ).to.be.reverted;

      expect(await token.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });

    it("Should update balances after transfers", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);
      const transferAmount = ethers.parseEther("100");

      await token.transfer(addr1.address, transferAmount);
      await token.transfer(addr2.address, transferAmount);

      const finalOwnerBalance = await token.balanceOf(owner.address);
      expect(finalOwnerBalance).to.equal(initialOwnerBalance - transferAmount * 2n);

      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);
      expect(await token.balanceOf(addr2.address)).to.equal(transferAmount);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");

      await token.mint(addr1.address, mintAmount);
      expect(await token.balanceOf(addr1.address)).to.equal(mintAmount);

      const totalSupply = await token.totalSupply();
      expect(totalSupply).to.equal(INITIAL_SUPPLY + mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");

      await expect(
        token.connect(addr1).mint(addr2.address, mintAmount)
      ).to.be.reverted;
    });
  });

  describe("Burning", function () {
    it("Should allow users to burn their tokens", async function () {
      const burnAmount = ethers.parseEther("100");

      const initialBalance = await token.balanceOf(owner.address);
      await token.burn(burnAmount);

      const finalBalance = await token.balanceOf(owner.address);
      expect(finalBalance).to.equal(initialBalance - burnAmount);

      const totalSupply = await token.totalSupply();
      expect(totalSupply).to.equal(INITIAL_SUPPLY - burnAmount);
    });

    it("Should allow burning from another account with allowance", async function () {
      const transferAmount = ethers.parseEther("100");
      const burnAmount = ethers.parseEther("50");

      // Transfer tokens to addr1
      await token.transfer(addr1.address, transferAmount);

      // Approve addr2 to spend addr1's tokens
      await token.connect(addr1).approve(addr2.address, burnAmount);

      // Burn from addr1's balance
      await token.connect(addr2).burnFrom(addr1.address, burnAmount);

      expect(await token.balanceOf(addr1.address)).to.equal(transferAmount - burnAmount);
    });

    it("Should fail if burning more than balance", async function () {
      const burnAmount = INITIAL_SUPPLY + ethers.parseEther("1");

      await expect(
        token.burn(burnAmount)
      ).to.be.reverted;
    });
  });
});
