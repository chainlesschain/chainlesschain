// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ChainlessNFT
 * @dev ERC721 NFT 合约，支持元数据 URI 和枚举功能
 *
 * 特性:
 * - 铸造 NFT 并设置元数据 URI
 * - 可枚举（查询所有 NFT）
 * - 所有者可以铸造 NFT
 * - 支持批量铸造
 * - 自动递增的 Token ID
 */
contract ChainlessNFT is ERC721URIStorage, ERC721Enumerable, Ownable {
    uint256 private _tokenIdCounter;

    /**
     * @dev 构造函数
     * @param name NFT 系列名称
     * @param symbol NFT 符号
     */
    constructor(
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) Ownable(msg.sender) {
        _tokenIdCounter = 0;
    }

    /**
     * @dev 铸造单个 NFT
     * @param to 接收地址
     * @param uri 元数据 URI (JSON)
     * @return 铸造的 Token ID
     */
    function mint(address to, string memory uri) public returns (uint256) {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }

    /**
     * @dev 批量铸造 NFT（仅限合约所有者）
     * @param to 接收地址
     * @param uris 元数据 URI 数组
     * @return 铸造的 Token ID 数组
     */
    function mintBatch(address to, string[] memory uris) public onlyOwner returns (uint256[] memory) {
        uint256[] memory tokenIds = new uint256[](uris.length);

        for (uint256 i = 0; i < uris.length; i++) {
            uint256 tokenId = _tokenIdCounter;
            _tokenIdCounter++;
            _safeMint(to, tokenId);
            _setTokenURI(tokenId, uris[i]);
            tokenIds[i] = tokenId;
        }

        return tokenIds;
    }

    /**
     * @dev 销毁 NFT
     * @param tokenId Token ID
     */
    function burn(uint256 tokenId) public {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");
        _burn(tokenId);
    }

    /**
     * @dev 获取下一个 Token ID
     */
    function nextTokenId() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev 获取指定地址拥有的所有 Token ID
     * @param owner 地址
     * @return Token ID 数组
     */
    function tokensOfOwner(address owner) public view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokens = new uint256[](balance);

        for (uint256 i = 0; i < balance; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner, i);
        }

        return tokens;
    }

    // ========== Override Required Functions ==========

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
