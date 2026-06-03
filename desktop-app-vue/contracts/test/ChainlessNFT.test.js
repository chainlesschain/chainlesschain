const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ChainlessNFT", function () {
  let nft;
  let owner;
  let addr1;
  let addr2;

  const NFT_NAME = "ChainlessChain NFT";
  const NFT_SYMBOL = "CCNFT";
  const TOKEN_URI_1 = "https://ipfs.io/ipfs/QmTest1";
  const TOKEN_URI_2 = "https://ipfs.io/ipfs/QmTest2";

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const ChainlessNFT = await ethers.getContractFactory("ChainlessNFT");
    nft = await ChainlessNFT.deploy(NFT_NAME, NFT_SYMBOL);
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await nft.name()).to.equal(NFT_NAME);
      expect(await nft.symbol()).to.equal(NFT_SYMBOL);
    });

    it("Should set the right owner", async function () {
      expect(await nft.owner()).to.equal(owner.address);
    });

    it("Should start with token ID counter at 0", async function () {
      expect(await nft.nextTokenId()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should mint a single NFT", async function () {
      const tx = await nft.mint(addr1.address, TOKEN_URI_1);
      const receipt = await tx.wait();

      expect(await nft.ownerOf(0)).to.equal(addr1.address);
      expect(await nft.tokenURI(0)).to.equal(TOKEN_URI_1);
      expect(await nft.balanceOf(addr1.address)).to.equal(1);
      expect(await nft.nextTokenId()).to.equal(1);
    });

    it("Should mint multiple NFTs with incrementing IDs", async function () {
      await nft.mint(addr1.address, TOKEN_URI_1);
      await nft.mint(addr2.address, TOKEN_URI_2);

      expect(await nft.ownerOf(0)).to.equal(addr1.address);
      expect(await nft.ownerOf(1)).to.equal(addr2.address);
      expect(await nft.nextTokenId()).to.equal(2);
    });

    it("Should batch mint NFTs (owner only)", async function () {
      const uris = [TOKEN_URI_1, TOKEN_URI_2, "https://ipfs.io/ipfs/QmTest3"];

      await nft.mintBatch(addr1.address, uris);

      expect(await nft.balanceOf(addr1.address)).to.equal(3);
      expect(await nft.tokenURI(0)).to.equal(TOKEN_URI_1);
      expect(await nft.tokenURI(1)).to.equal(TOKEN_URI_2);
      expect(await nft.tokenURI(2)).to.equal(uris[2]);
      expect(await nft.nextTokenId()).to.equal(3);
    });

    it("Should not allow non-owner to batch mint", async function () {
      const uris = [TOKEN_URI_1, TOKEN_URI_2];

      await expect(
        nft.connect(addr1).mintBatch(addr1.address, uris)
      ).to.be.reverted;
    });
  });

  describe("Token URI", function () {
    it("Should return the correct token URI", async function () {
      await nft.mint(addr1.address, TOKEN_URI_1);
      expect(await nft.tokenURI(0)).to.equal(TOKEN_URI_1);
    });

    it("Should revert for non-existent token", async function () {
      await expect(
        nft.tokenURI(999)
      ).to.be.reverted;
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await nft.mint(addr1.address, TOKEN_URI_1);
    });

    it("Should transfer NFT between accounts", async function () {
      await nft.connect(addr1).transferFrom(addr1.address, addr2.address, 0);

      expect(await nft.ownerOf(0)).to.equal(addr2.address);
      expect(await nft.balanceOf(addr1.address)).to.equal(0);
      expect(await nft.balanceOf(addr2.address)).to.equal(1);
    });

    it("Should not allow unauthorized transfer", async function () {
      await expect(
        nft.connect(addr2).transferFrom(addr1.address, addr2.address, 0)
      ).to.be.reverted;
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await nft.mint(addr1.address, TOKEN_URI_1);
    });

    it("Should allow owner to burn their NFT", async function () {
      await nft.connect(addr1).burn(0);

      await expect(nft.ownerOf(0)).to.be.reverted;
      expect(await nft.balanceOf(addr1.address)).to.equal(0);
    });

    it("Should not allow non-owner to burn NFT", async function () {
      await expect(
        nft.connect(addr2).burn(0)
      ).to.be.reverted;
    });
  });

  describe("Enumeration", function () {
    beforeEach(async function () {
      await nft.mint(addr1.address, TOKEN_URI_1);
      await nft.mint(addr1.address, TOKEN_URI_2);
      await nft.mint(addr2.address, "https://ipfs.io/ipfs/QmTest3");
    });

    it("Should return total supply", async function () {
      expect(await nft.totalSupply()).to.equal(3);
    });

    it("Should return tokens of owner", async function () {
      const tokens = await nft.tokensOfOwner(addr1.address);
      expect(tokens.length).to.equal(2);
      expect(tokens[0]).to.equal(0);
      expect(tokens[1]).to.equal(1);
    });

    it("Should return token by index", async function () {
      expect(await nft.tokenByIndex(0)).to.equal(0);
      expect(await nft.tokenByIndex(1)).to.equal(1);
      expect(await nft.tokenByIndex(2)).to.equal(2);
    });

    it("Should return token of owner by index", async function () {
      expect(await nft.tokenOfOwnerByIndex(addr1.address, 0)).to.equal(0);
      expect(await nft.tokenOfOwnerByIndex(addr1.address, 1)).to.equal(1);
    });
  });

  describe("Supports Interface", function () {
    it("Should support ERC721 interface", async function () {
      // ERC721 interface ID: 0x80ac58cd
      expect(await nft.supportsInterface("0x80ac58cd")).to.be.true;
    });

    it("Should support ERC721Metadata interface", async function () {
      // ERC721Metadata interface ID: 0x5b5e139f
      expect(await nft.supportsInterface("0x5b5e139f")).to.be.true;
    });

    it("Should support ERC721Enumerable interface", async function () {
      // ERC721Enumerable interface ID: 0x780e9d63
      expect(await nft.supportsInterface("0x780e9d63")).to.be.true;
    });
  });
});
