// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DecisionRegistry
/// @notice Stores SignalSprint decision receipts and no-pot Reason Duels on-chain.
contract DecisionRegistry {
    uint256 public constant MAX_TEXT_BYTES = 280;

    struct Decision {
        bytes32 marketId;
        bytes32 tradeHash;
        uint8 side;
        uint8 confidence;
        string thesis;
        uint64 createdAt;
    }

    struct Call {
        address trader;
        uint8 side;
        uint8 confidence;
        string reason;
        uint256 amount;
    }

    struct Challenge {
        bytes32 marketId;
        uint64 expiry;
        uint64 createdAt;
        Call creator;
        Call opponent;
    }

    uint256 public nextChallengeId = 1;
    mapping(address => Decision[]) private decisions;
    mapping(uint256 => Challenge) private challenges;
    mapping(address => uint256[]) private walletChallenges;

    event DecisionRecorded(address indexed trader, bytes32 indexed marketId, bytes32 indexed tradeHash, uint8 side, uint8 confidence, string thesis, uint64 createdAt);
    event ChallengeCreated(uint256 indexed challengeId, address indexed creator, bytes32 indexed marketId, uint64 expiry);
    event ChallengeJoined(uint256 indexed challengeId, address indexed opponent);

    error InvalidSide();
    error InvalidConfidence();
    error TextTooLong();
    error InvalidExpiry();
    error ChallengeNotFound();
    error ChallengeExpired();
    error ChallengeAlreadyJoined();
    error CreatorCannotJoin();

    function recordDecision(bytes32 marketId, bytes32 tradeHash, uint8 side, uint8 confidence, string calldata thesis) external {
        _validateCall(side, confidence, thesis);
        Decision memory decision = Decision(marketId, tradeHash, side, confidence, thesis, uint64(block.timestamp));
        decisions[msg.sender].push(decision);
        emit DecisionRecorded(msg.sender, marketId, tradeHash, side, confidence, thesis, decision.createdAt);
    }

    function getDecisions(address trader) external view returns (Decision[] memory) {
        return decisions[trader];
    }

    function createChallenge(bytes32 marketId, uint8 side, uint8 confidence, string calldata reason, uint256 amount, uint64 expiry) external returns (uint256 challengeId) {
        _validateCall(side, confidence, reason);
        if (expiry <= block.timestamp) revert InvalidExpiry();

        challengeId = nextChallengeId++;
        Challenge storage challenge = challenges[challengeId];
        challenge.marketId = marketId;
        challenge.expiry = expiry;
        challenge.createdAt = uint64(block.timestamp);
        challenge.creator = Call(msg.sender, side, confidence, reason, amount);
        walletChallenges[msg.sender].push(challengeId);
        emit ChallengeCreated(challengeId, msg.sender, marketId, expiry);
    }

    function joinChallenge(uint256 challengeId, uint8 side, uint8 confidence, string calldata reason, uint256 amount) external {
        _validateCall(side, confidence, reason);
        Challenge storage challenge = challenges[challengeId];
        if (challenge.creator.trader == address(0)) revert ChallengeNotFound();
        if (block.timestamp >= challenge.expiry) revert ChallengeExpired();
        if (challenge.opponent.trader != address(0)) revert ChallengeAlreadyJoined();
        if (challenge.creator.trader == msg.sender) revert CreatorCannotJoin();

        challenge.opponent = Call(msg.sender, side, confidence, reason, amount);
        walletChallenges[msg.sender].push(challengeId);
        emit ChallengeJoined(challengeId, msg.sender);
    }

    function getChallenge(uint256 challengeId) external view returns (Challenge memory) {
        Challenge memory challenge = challenges[challengeId];
        if (challenge.creator.trader == address(0)) revert ChallengeNotFound();
        return challenge;
    }

    function getChallengesForWallet(address trader) external view returns (uint256[] memory) {
        return walletChallenges[trader];
    }

    function _validateCall(uint8 side, uint8 confidence, string calldata text) private pure {
        if (side > 1) revert InvalidSide();
        if (confidence > 100) revert InvalidConfidence();
        if (bytes(text).length > MAX_TEXT_BYTES) revert TextTooLong();
    }
}
