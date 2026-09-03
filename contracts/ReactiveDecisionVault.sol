// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

enum ConsensusType { Majority, Threshold }
enum ResponseStatus { None, Pending, Success, Failed, TimedOut }

struct AgentResponse {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct AgentRequest {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    AgentResponse[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequester {
    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);
}

interface ILlmAgent {
    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool chainOfThought
    ) external returns (int256 response);
}

interface IBinaryPool {
    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool success, uint128 id);

    function getBinaryPoolParams()
        external
        view
        returns (
            address collateralToken,
            address market,
            address outcomeToken,
            uint256 yesId,
            uint256 noId,
            uint256 oneCollateral,
            uint256 setBacking,
            address feeRecipient,
            uint256 makerFeeBpsTimes1k,
            uint256 takerFeeBpsTimes1k,
            uint256 maxBuilderFeeBpsTimes1k,
            uint256 settlementFeeBpsTimes1k,
            address settlement,
            uint64 marketNonce,
            bool finalized
        );

    function marketNonce() external view returns (uint64);
}

interface IBinaryMarket {
    function status() external view returns (uint8);
    function expiry() external view returns (uint64);
    function isResolved() external view returns (bool);
    function isVoided() external view returns (bool);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC6909 {
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

interface IBinarySettlement {
    function finalizeAndRedeem(address pool, uint256 outcomeId, uint256 amount, address to)
        external
        returns (uint256 collateralOut);
    function claimOwed(address token) external returns (uint256 amount);
}

/// @title ReactiveDecisionVault
/// @notice One owner, one event market. Somnia reactivity watches the bound
/// BinaryPool for real OrderFilled events; a qualifying fill triggers Somnia's
/// deterministic LLM agent, which returns a constrained 0-100 fair-YES
/// probability. The vault trades only when that probability differs from the
/// triggering fill price by the owner's minimum edge; otherwise it records an
/// explicit skip. Every prediction - including rejected signals - becomes an
/// auditable receipt for post-settlement Brier scoring.
/// @dev This contract is unaudited hackathon software. Shadow mode is default.
contract ReactiveDecisionVault is SomniaEventHandler {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @dev keccak256("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)")
    bytes32 public constant ORDER_FILLED_TOPIC =
        0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant CONSENSUS_THRESHOLD = 2;
    uint256 public constant ADVANCED_REQUEST_TIMEOUT = 300 seconds;
    /// @dev Documented LLM runner execution headroom (0.07 SOMI per runner).
    uint256 public constant LLM_EXECUTION_COST_PER_AGENT = 0.07 ether;
    /// @dev placeBinaryOrder OrderType: 2 = ImmediateOrCancel.
    uint8 public constant ORDER_TYPE_IOC = 2;
    /// @dev placeBinaryOrder OrderKind: 0 BUY_YES, 2 BUY_NO.
    uint8 public constant KIND_BUY_YES = 0;
    uint8 public constant KIND_BUY_NO = 2;
    /// @dev Market status below this value means still trading (2 = Locked).
    uint8 public constant MARKET_STATUS_LOCKED = 2;
    /// @dev Seconds of expiry headroom required before requesting a decision.
    uint64 public constant MIN_EXPIRY_HEADROOM = 120 seconds;
    /// @dev IOC order lifetime.
    uint64 public constant IOC_LIFETIME_SECONDS = 60 seconds;
    uint256 public constant MAX_THESIS_BYTES = 280;
    uint256 public constant MAX_DECISIONS = 10;
    /// @dev Allowed direction: 0 both, 1 YES only, 2 NO only.
    uint8 public constant DIRECTION_BOTH = 0;
    uint8 public constant DIRECTION_YES = 1;
    uint8 public constant DIRECTION_NO = 2;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public immutable owner;
    address public immutable agentRequester;
    uint256 public immutable agentId;
    address public immutable market;
    address public immutable pool;

    string public question;
    string public thesis;
    /// @dev 0 both, 1 YES only, 2 NO only.
    uint8 public allowedDirection;
    /// @dev Minimum triggering fill size, in raw quantity units.
    uint256 public minFillRaw;
    /// @dev Minimum edge between agent probability and fill price, in raw price bps of one.
    uint256 public minEdgeBps;
    /// @dev Maximum contracts per decision, raw quantity units.
    uint256 public maxContractsRaw;
    /// @dev Slippage tolerance beyond the triggering fill price, in raw price bps of one.
    uint256 public slippageBps;
    uint64 public cooldownSeconds;
    uint8 public maxDecisions;
    bool public shadowMode;

    // Binding snapshot taken at arm time.
    address public collateralToken;
    address public outcomeToken;
    address public settlement;
    uint256 public yesId;
    uint256 public noId;
    uint256 public oneCollateral;
    uint256 public tickSize;
    uint256 public lotSize;
    uint256 public minQuantity;
    uint64 public poolNonceAtArm;

    // Runtime.
    bool public armed;
    bool public executed;
    uint256 public subscriptionId;
    uint256 public pendingRequestId;
    uint256 public triggerFillPrice;
    uint256 public triggerFillQuantity;
    uint64 public lastDecisionAt;
    uint8 public decisionsPaid;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Armed(uint256 indexed subscriptionId, uint256 collateralApproved);
    event SignalObserved(uint256 indexed requestId, uint256 fillPrice, uint256 quantityFilled);
    event DecisionReceipt(
        uint256 indexed requestId,
        uint256 probability,
        uint8 side,
        bool wouldExecute,
        bool executed,
        uint256 orderId,
        uint256 price,
        uint256 quantity,
        string reason
    );
    event Stopped();
    event Redeemed(uint256 collateralOut);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error OnlyOwner();
    error AlreadyArmed();
    error NotArmed();
    error RequestPending();
    error InsufficientReserve();
    error ThesisTooLong();
    error InvalidDirection();
    error InvalidParameter();
    error InvalidEmitter();
    error InvalidTopic();
    error UnknownRequest();
    error NotInactive();
    error NothingToRedeem();
    error PoolRecycled();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(
        address owner_,
        address agentRequester_,
        uint256 agentId_,
        address market_,
        address pool_,
        string memory question_,
        string memory thesis_,
        uint8 allowedDirection_,
        uint256 minFillRaw_,
        uint256 minEdgeBps_,
        uint256 maxContractsRaw_,
        uint256 slippageBps_,
        uint64 cooldownSeconds_,
        uint8 maxDecisions_,
        bool shadowMode_
    ) payable {
        if (owner_ == address(0) || agentRequester_ == address(0) || market_ == address(0) || pool_ == address(0)) {
            revert InvalidParameter();
        }
        if (allowedDirection_ > DIRECTION_NO) revert InvalidDirection();
        if (minEdgeBps_ == 0 || slippageBps_ == 0 || maxContractsRaw_ == 0 || cooldownSeconds_ == 0) {
            revert InvalidParameter();
        }
        if (maxDecisions_ == 0 || maxDecisions_ > MAX_DECISIONS) revert InvalidParameter();
        if (bytes(thesis_).length > MAX_THESIS_BYTES) revert ThesisTooLong();

        owner = owner_;
        agentRequester = agentRequester_;
        agentId = agentId_;
        market = market_;
        pool = pool_;
        question = question_;
        thesis = thesis_;
        allowedDirection = allowedDirection_;
        minFillRaw = minFillRaw_;
        minEdgeBps = minEdgeBps_;
        maxContractsRaw = maxContractsRaw_;
        slippageBps = slippageBps_;
        cooldownSeconds = cooldownSeconds_;
        maxDecisions = maxDecisions_;
        shadowMode = shadowMode_;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // Arming
    // ---------------------------------------------------------------------

    /// @notice Snapshots the pool binding, approves the pool for the exact
    /// collateral balance, and subscribes to the pool's OrderFilled topic.
    /// Requires the vault to hold the 32 STT reactivity reserve (not consumed).
    function arm() external onlyOwner {
        if (armed) revert AlreadyArmed();
        if (address(this).balance < SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE) {
            revert InsufficientReserve();
        }

        (
            address collateralToken_,
            address market_,
            address outcomeToken_,
            uint256 yesId_,
            uint256 noId_,
            uint256 oneCollateral_,
            ,
            ,
            ,
            ,
            ,
            ,
            address settlement_,
            uint64 marketNonce_,
            bool finalized
        ) = IBinaryPool(pool).getBinaryPoolParams();
        if (market_ != market || finalized) revert InvalidParameter();

        collateralToken = collateralToken_;
        outcomeToken = outcomeToken_;
        settlement = settlement_;
        yesId = yesId_;
        noId = noId_;
        oneCollateral = oneCollateral_;
        poolNonceAtArm = marketNonce_;

        (uint256 tickSize_, uint256 minQuantity_, uint256 lotSize_) = _orderBookParameters();
        tickSize = tickSize_;
        minQuantity = minQuantity_;
        lotSize = lotSize_;

        uint256 collateralBalance = IERC20(collateralToken_).balanceOf(address(this));
        if (collateralBalance > 0) {
            IERC20(collateralToken_).approve(pool, collateralBalance);
        }

        SomniaExtensions.SubscriptionFilter memory filter;
        filter.eventTopics[0] = ORDER_FILLED_TOPIC;
        filter.emitter = pool;

        subscriptionId = SomniaExtensions.subscribe(
            address(this),
            filter,
            SomniaExtensions.defaultSubscriptionOptions()
        );
        armed = true;
        emit Armed(subscriptionId, collateralBalance);
    }

    function _orderBookParameters()
        private
        view
        returns (uint256 tickSize_, uint256 minQuantity_, uint256 lotSize_)
    {
        (bool ok, bytes memory data) = pool.staticcall(abi.encodeWithSignature("getOrderBookParameters()"));
        if (!ok || data.length < 96) revert InvalidParameter();
        (tickSize_, minQuantity_, lotSize_) = abi.decode(data, (uint256, uint256, uint256));
    }

    // ---------------------------------------------------------------------
    // Reactive trigger
    // ---------------------------------------------------------------------

    /// @inheritdoc SomniaEventHandler
    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data) internal override {
        if (!armed || pendingRequestId != 0) return;
        // The subscription filter should guarantee these; fail closed silently
        // rather than reverting the callback if the chain ever mismatches.
        if (emitter != pool) return;
        if (eventTopics.length < 3 || eventTopics[0] != ORDER_FILLED_TOPIC) return;

        (uint256 quantityFilled, , , uint256 fillPrice) = abi.decode(data, (uint256, uint256, uint256, uint256));

        // Market freshness.
        IBinaryMarket marketContract = IBinaryMarket(market);
        if (marketContract.status() >= MARKET_STATUS_LOCKED) return;
        if (marketContract.isResolved() || marketContract.isVoided()) return;
        if (marketContract.expiry() <= block.timestamp + MIN_EXPIRY_HEADROOM) return;

        // Pool recycle guard: fail closed and disarm rather than act on a
        // recycled book.
        if (IBinaryPool(pool).marketNonce() != poolNonceAtArm) {
            armed = false;
            emit Stopped();
            return;
        }

        // Policy gates.
        if (quantityFilled < minFillRaw) return;
        if (decisionsPaid >= maxDecisions) return;
        if (lastDecisionAt != 0 && block.timestamp < lastDecisionAt + cooldownSeconds) return;

        uint256 deposit = IAgentRequester(agentRequester).getAdvancedRequestDeposit(SUBCOMMITTEE_SIZE)
            + LLM_EXECUTION_COST_PER_AGENT * SUBCOMMITTEE_SIZE;
        if (address(this).balance < deposit) return;

        bytes memory payload = abi.encodeWithSelector(
            ILlmAgent.inferNumber.selector,
            _buildPrompt(fillPrice),
            _SYSTEM_PROMPT,
            int256(0),
            int256(100),
            false
        );

        triggerFillPrice = fillPrice;
        triggerFillQuantity = quantityFilled;
        pendingRequestId = IAgentRequester(agentRequester).createAdvancedRequest{value: deposit}(
            agentId,
            address(this),
            this.handleResponse.selector,
            payload,
            SUBCOMMITTEE_SIZE,
            CONSENSUS_THRESHOLD,
            ConsensusType.Majority,
            ADVANCED_REQUEST_TIMEOUT
        );
        emit SignalObserved(pendingRequestId, fillPrice, quantityFilled);
    }

    string private constant _SYSTEM_PROMPT =
        "You are a calibrated probability estimator for binary event markets. "
        "Weigh the observed trade flow against the stated thesis. "
        "Output a single integer between 0 and 100: your fair probability that YES wins.";

    function _buildPrompt(uint256 fillPrice) private view returns (string memory) {
        return string.concat(
            "Event market: ",
            question,
            ". A trade just printed YES at ",
            _pricePercent(fillPrice),
            " (out of 100). Policy thesis: ",
            thesis,
            ". What is the fair probability (0-100) that YES wins? Reply with the integer only."
        );
    }

    function _pricePercent(uint256 rawPrice) private view returns (string memory) {
        // Render rawPrice as a 0-100 percentage with two decimals.
        uint256 scaled = (rawPrice * 10000) / oneCollateral; // basis points of one
        uint256 whole = scaled / 100;
        uint256 frac = scaled % 100;
        return string.concat(_utoa(whole), ".", frac < 10 ? "0" : "", _utoa(frac));
    }

    function _utoa(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    // ---------------------------------------------------------------------
    // Agent callback
    // ---------------------------------------------------------------------

    /// @notice Authenticated platform callback. Derives the majority value
    /// rather than trusting the first response, then executes or skips.
    function handleResponse(
        uint256 requestId,
        AgentResponse[] memory responses,
        ResponseStatus status,
        AgentRequest memory details
    ) external {
        if (msg.sender != agentRequester) revert UnknownRequest();
        if (requestId != pendingRequestId) revert UnknownRequest();

        pendingRequestId = 0;
        lastDecisionAt = uint64(block.timestamp);
        decisionsPaid += 1;

        if (status != ResponseStatus.Success) {
            emit DecisionReceipt(
                requestId, 0, 0, false, false, 0, 0, 0,
                status == ResponseStatus.TimedOut ? "agent timed out" : "agent failed"
            );
            return;
        }

        (bool found, uint256 probability) = _majorityProbability(responses, details.threshold);
        if (!found) {
            emit DecisionReceipt(requestId, 0, 0, false, false, 0, 0, 0, "no consensus value");
            return;
        }

        uint256 fillPrice = triggerFillPrice;
        uint256 edgeRaw = (minEdgeBps * oneCollateral) / 10000;
        uint256 slippageRaw = (slippageBps * oneCollateral) / 10000;

        uint8 side;
        uint256 limitPrice;
        string memory reason;

        if (probability * oneCollateral / 100 > fillPrice + edgeRaw) {
            side = KIND_BUY_YES;
            uint256 fairRaw = (probability * oneCollateral) / 100;
            uint256 maxPay = fillPrice + slippageRaw;
            limitPrice = maxPay < fairRaw ? maxPay : fairRaw - 1;
        } else if (probability * oneCollateral / 100 < fillPrice - edgeRaw) {
            side = KIND_BUY_NO;
            uint256 fairRaw = (probability * oneCollateral) / 100;
            uint256 minAccept = fillPrice - slippageRaw;
            limitPrice = minAccept > fairRaw + 1 ? minAccept : fairRaw + 1;
        } else {
            emit DecisionReceipt(
                requestId, probability, 0, false, false, 0, 0, 0, "insufficient edge"
            );
            return;
        }

        if (allowedDirection == DIRECTION_YES && side == KIND_BUY_NO) {
            emit DecisionReceipt(requestId, probability, side, false, false, 0, 0, 0, "direction not allowed");
            return;
        }
        if (allowedDirection == DIRECTION_NO && side == KIND_BUY_YES) {
            emit DecisionReceipt(requestId, probability, side, false, false, 0, 0, 0, "direction not allowed");
            return;
        }

        limitPrice = _snapPrice(side, limitPrice);
        if (limitPrice == 0 || limitPrice >= oneCollateral) {
            emit DecisionReceipt(requestId, probability, side, false, false, 0, 0, 0, "price out of range");
            return;
        }

        uint256 quantity = _affordableQuantity(side, limitPrice);
        if (quantity < minQuantity) {
            emit DecisionReceipt(requestId, probability, side, false, false, 0, 0, 0, "insufficient collateral");
            return;
        }

        if (shadowMode) {
            emit DecisionReceipt(
                requestId, probability, side, true, false, 0, limitPrice, quantity, "shadow mode"
            );
            return;
        }

        // Disable before placing so the vault's own fill cannot retrigger it.
        armed = false;

        (bool success, uint128 orderId) = IBinaryPool(pool).placeBinaryOrder(
            side,
            limitPrice,
            quantity,
            uint64((block.timestamp + IOC_LIFETIME_SECONDS) * 1e9),
            ORDER_TYPE_IOC,
            0,
            address(0),
            0,
            0
        );
        executed = success;
        emit DecisionReceipt(
            requestId,
            probability,
            side,
            true,
            success,
            orderId,
            limitPrice,
            quantity,
            success ? "executed" : "ioc unmatched"
        );
    }

    function _majorityProbability(AgentResponse[] memory responses, uint256 threshold)
        private
        pure
        returns (bool found, uint256 probability)
    {
        uint256 required = threshold > 0 ? threshold : CONSENSUS_THRESHOLD;
        uint256 n = responses.length;
        for (uint256 i = 0; i < n; i++) {
            if (responses[i].status != ResponseStatus.Success) continue;
            int256 value = abi.decode(responses[i].result, (int256));
            if (value < 0 || value > 100) continue;
            uint256 count = 1;
            for (uint256 j = i + 1; j < n; j++) {
                if (responses[j].status != ResponseStatus.Success) continue;
                if (abi.decode(responses[j].result, (int256)) == value) count++;
            }
            if (count >= required) {
                return (true, uint256(value));
            }
        }
        return (false, 0);
    }

    /// @dev Snap a YES-side limit price onto the tick grid. For BUY_YES the
    /// limit rounds down (pay no more); for BUY_NO the YES-side price rounds
    /// up (the NO cost = one - price rounds down).
    function _snapPrice(uint8 side, uint256 price) private view returns (uint256) {
        if (tickSize == 0) return price;
        if (side == KIND_BUY_YES) return (price / tickSize) * tickSize;
        uint256 rounded = ((price + tickSize - 1) / tickSize) * tickSize;
        return rounded >= oneCollateral ? 0 : rounded;
    }

    /// @dev Largest lot-aligned quantity the vault can fund at `price`.
    /// BUY_YES costs price per contract; BUY_NO costs (one - price).
    function _affordableQuantity(uint8 side, uint256 price) private view returns (uint256) {
        uint256 unitCost = side == KIND_BUY_YES ? price : oneCollateral - price;
        if (unitCost == 0) return 0;
        uint256 budget = IERC20(collateralToken).balanceOf(address(this));
        uint256 affordable = (budget * oneCollateral) / unitCost;
        uint256 quantity = maxContractsRaw < affordable ? maxContractsRaw : affordable;
        if (lotSize > 0) quantity = (quantity / lotSize) * lotSize;
        return quantity;
    }

    // ---------------------------------------------------------------------
    // Owner controls
    // ---------------------------------------------------------------------

    function stop() external onlyOwner {
        if (subscriptionId != 0) {
            SomniaExtensions.unsubscribe(subscriptionId);
            subscriptionId = 0;
        }
        armed = false;
        emit Stopped();
    }

    /// @notice Redeem settled outcome positions to the owner after resolution.
    function redeem() external onlyOwner {
        IBinaryMarket marketContract = IBinaryMarket(market);
        if (!marketContract.isResolved() && !marketContract.isVoided()) revert NothingToRedeem();

        uint256 total;
        total += _redeemOutcome(yesId);
        total += _redeemOutcome(noId);
        if (total == 0) revert NothingToRedeem();
        emit Redeemed(total);
    }

    function _redeemOutcome(uint256 outcomeId) private returns (uint256) {
        uint256 balance = IERC6909(outcomeToken).balanceOf(address(this), outcomeId);
        if (balance == 0) return 0;
        return IBinarySettlement(settlement).finalizeAndRedeem(pool, outcomeId, balance, owner);
    }

    /// @notice Sweep native and collateral balances back to the owner. Only
    /// allowed when the vault is inactive with no pending agent request.
    function recover() external onlyOwner {
        if (armed || pendingRequestId != 0) revert NotInactive();
        uint256 nativeBalance = address(this).balance;
        if (nativeBalance > 0) {
            (bool ok, ) = owner.call{value: nativeBalance}("");
            if (!ok) revert InvalidParameter();
        }
        if (collateralToken != address(0)) {
            uint256 tokenBalance = IERC20(collateralToken).balanceOf(address(this));
            if (tokenBalance > 0) {
                IERC20(collateralToken).transfer(owner, tokenBalance);
            }
        }
    }

    function transferERC20(address token, address to, uint256 amount) external onlyOwner {
        if (armed || pendingRequestId != 0) revert NotInactive();
        IERC20(token).transfer(to, amount);
    }
}
