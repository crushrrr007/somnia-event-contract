// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReactiveDecisionVault} from "./ReactiveDecisionVault.sol";

interface IERC20Factory {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ReactiveDecisionFactory
/// @notice Deploys owner-scoped ReactiveDecisionVaults, forwards the user's
/// native budget (32 STT reactivity reserve + per-decision agent deposits),
/// pulls only the approved collateral amount into the new vault, arms it, and
/// indexes vaults by owner.
/// @dev Unaudited hackathon software. Production uses the official Shannon
/// AgentRequester address; the constructor parameter keeps that explicit.
contract ReactiveDecisionFactory {
    address public immutable agentRequester;
    uint256 public immutable agentId;

    mapping(address => address[]) private vaultsByOwner;

    event VaultCreated(
        address indexed owner,
        address indexed vault,
        address indexed market,
        address pool,
        bool shadowMode
    );

    error InvalidParameter();
    error ArmFailed();

    constructor(address agentRequester_, uint256 agentId_) {
        if (agentRequester_ == address(0)) revert InvalidParameter();
        agentRequester = agentRequester_;
        agentId = agentId_;
    }

    struct Policy {
        address market;
        address pool;
        string question;
        string thesis;
        uint8 allowedDirection;
        uint256 minFillRaw;
        uint256 minEdgeBps;
        uint256 maxContractsRaw;
        uint256 slippageBps;
        uint64 cooldownSeconds;
        uint8 maxDecisions;
        bool shadowMode;
    }

    /// @notice Deploy, fund, collateralize, and arm a new vault.
    /// @param policy The decision policy (validated again by the vault).
    /// @param collateralToken The pool's tUSDC-style collateral token.
    /// @param collateralAmount Exact collateral to pull from the creator.
    /// msg.value is forwarded to the vault as its native budget and must cover
    /// the 32 STT reactivity reserve plus per-decision agent deposits.
    function createVault(Policy calldata policy, address collateralToken, uint256 collateralAmount)
        external
        payable
        returns (address vault)
    {
        if (policy.market == address(0) || policy.pool == address(0)) revert InvalidParameter();
        if (msg.value == 0) revert InvalidParameter();

        ReactiveDecisionVault vaultContract = new ReactiveDecisionVault{
            value: msg.value
        }(
            msg.sender,
            agentRequester,
            agentId,
            policy.market,
            policy.pool,
            policy.question,
            policy.thesis,
            policy.allowedDirection,
            policy.minFillRaw,
            policy.minEdgeBps,
            policy.maxContractsRaw,
            policy.slippageBps,
            policy.cooldownSeconds,
            policy.maxDecisions,
            policy.shadowMode
        );
        vault = address(vaultContract);

        if (collateralAmount > 0) {
            if (!IERC20Factory(collateralToken).transferFrom(msg.sender, vault, collateralAmount)) {
                revert InvalidParameter();
            }
        }

        vaultContract.arm();

        vaultsByOwner[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault, policy.market, policy.pool, policy.shadowMode);
    }

    function getVaults(address owner_) external view returns (address[] memory) {
        return vaultsByOwner[owner_];
    }
}
