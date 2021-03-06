pragma ton-solidity >= 0.39.0;
pragma AbiHeader time;
pragma AbiHeader pubkey;
pragma AbiHeader expire;

import "Errors.sol";
import "Gas.sol";

import "./interfaces/tokens/IRootTokenContract.sol";
import "./interfaces/tokens/ITONTokenWallet.sol";
import "./interfaces/tokens/ITokensReceivedCallback.sol";
import "../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol";
import "../node_modules/@broxus/contracts/contracts/utils/RandomNonce.sol";


contract Vesting is ITokensReceivedCallback, RandomNonce {

    event TokensSent(address to, uint128 amount);
    event TokensReceived(address from, uint128 amount);
    event RevokeCalled();
    event ReleaseCalled(uint32 timespamp, uint128 amount);
    
    enum Status {
        Initializing,
        WaitingForTokens,
        Pending,
        Active,
        Released,
        Revoked
    }

    address public static owner;
    address public static tokenRoot;
    address public static beneficiary;

    uint32 public static startTime;
    uint32 public static duration;
    uint32 public static step;

    bool public static revocable;
    bool public revoked;

    address public tokenWallet;
    uint32 public lastWithdraw;
    uint128 public initialBalance;
    uint128 public balance;

    modifier onlyBeneficiary {
        require(msg.sender == beneficiary, Errors.NOT_BENEFICIARY);
        _;
    }

    modifier onlyOwner {
        require(msg.sender == owner, Errors.NOT_OWNER);
        _;
    }

    constructor() public {
        require(beneficiary.value != 0, Errors.EMPTY_BENEFICIARY);
        require(step <= duration, Errors.STEP_LONGER_THEN_DURATION);
        require(tokenRoot.value != 0, Errors.TOKEN_ROOT_IS_EMTPY);
        require(duration > 0, Errors.ZERO_DURATION);
        require(startTime > now, Errors.START_TIME_IN_PAST);
        if (tvm.pubkey() != 0) {
            require(msg.pubkey() == tvm.pubkey(), Errors.WRONG_PUBKEY);
            require(address(this).balance >= Gas.DEPLOY_VALUE, Errors.DEPLOY_VALUE_TOO_LOW);
            tvm.accept();
        } else {
            require(msg.value >= Gas.DEPLOY_VALUE, Errors.DEPLOY_VALUE_TOO_LOW);
        }

        lastWithdraw = startTime;
        _deployWallets();
    }

    function release() public onlyBeneficiary {
        require(msg.value >= Gas.RELEASE_MSG_VALUE, Errors.RELEASE_MSG_VALUE_TOO_LOW);
        require(_status() == Status.Active, Errors.VESTING_IS_NOT_ACTIVE);
        uint128 amountToRelease = _releasableAmount();
        require(amountToRelease > 0, Errors.RELEASE_AMOUNT_IS_ZERO);
        _reserve();

        if (amountToRelease > balance) {
            amountToRelease = balance;
            balance = 0;
        } else {
            balance -= amountToRelease;
        }
        lastWithdraw = now;

        emit ReleaseCalled(lastWithdraw, amountToRelease);

        sendTokens(beneficiary, amountToRelease, beneficiary);
    }

    function revoke() public onlyOwner {
        require(msg.value >= Gas.REVOKE_MSG_VALUE, Errors.REVOKE_MSG_VALUE_TOO_LOW);
        require(revocable, Errors.CANT_REVOKE);
        _reserve();

        revoked = true;

        emit RevokeCalled();

        ITONTokenWallet(tokenWallet).balance{value: 0, flag: MsgFlag.ALL_NOT_RESERVED, callback: onGetBalanceRevoke}();
    }

    function releasableAmount() public view responsible returns (uint128) {
        return {value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS} _releasableAmount();
    }

    function getDetails() public view responsible returns (
        address owner_,
        address tokenRoot_,
        address beneficiary_,
        uint32 startTime_,
        uint32 duration_,
        uint32 step_,
        uint32 lastWithdraw_,
        bool revocable_,
        bool revoked_,
        uint128 initialBalance_,
        uint128 balance_,
        Status status_
    ) {
        return {value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS} (owner, tokenRoot, beneficiary, startTime,
            duration, step, lastWithdraw, revocable, revoked, initialBalance, balance, _status());
    }

    function status() public view responsible returns(Status) {
        return {value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS} _status();
    }

    function onGetBalanceRevoke(uint128 walletBalance) public view {
        require(msg.sender.value != 0 && msg.sender == tokenWallet, Errors.NOT_TOKEN_WALLET);
        _reserve();
        sendTokens(owner, walletBalance, owner);
    }

    function tokensReceivedCallback(
        address tokenWallet_,
        address /*token_root*/,
        uint128 tokensAmount,
        uint256 /*sender_public_key*/,
        address senderAddress,
        address senderWallet,
        address originalGasTo,
        uint128 /*updated_balance*/,
        TvmCell /*payload*/
    ) override public {
        require(msg.sender.value != 0 && msg.sender == tokenWallet && tokenWallet == tokenWallet_, Errors.WRONG_SENDER);
        _reserve();

        if (
            senderAddress == owner &&
            _status() == Status.WaitingForTokens
        ) {
            initialBalance = tokensAmount;
            balance = initialBalance;
            emit TokensReceived(senderAddress, tokensAmount);
            originalGasTo.transfer({value: 0, flag: MsgFlag.ALL_NOT_RESERVED});
        } else {
            TvmCell empty;
            ITONTokenWallet(msg.sender).transfer{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
                senderWallet,
                tokensAmount,
                0,
                originalGasTo,
                false,
                empty
            );
        }
    }

    function _status() private view returns(Status) {
         if (tokenWallet.value == 0) {
             return Status.Initializing;
         }
         if (initialBalance == 0) {
             return Status.WaitingForTokens;
         }
         if (revoked) {
             return Status.Revoked;
         }
         if (balance == 0) {
             return Status.Released;
         }
        if (now < startTime) {
             return Status.Pending;
         }
         return Status.Active;
    }

    function sendTokens(address to, uint128 amount, address sendGasTo) private view {

        emit TokensSent(to, amount);

        TvmCell empty;
        ITONTokenWallet(tokenWallet).transferToRecipient{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
            0,                // recipient_public_key
            to,               // recipient_address
            amount,
            0,                // deploy_grams
            0,                // transfer_grams
            sendGasTo,
            true,            // notify_receiver
            empty
        );
    }

    function _releasableAmount() private view returns (uint128) {
        if (now < lastWithdraw + step) {
            return 0;
        }
        if (now >= startTime + duration) {
            return initialBalance;
        } else {
            return initialBalance / (duration / step) * ((now - lastWithdraw) / step);
        }
    }

    function _deployWallets() private view inline {

        IRootTokenContract(tokenRoot)
            .deployEmptyWallet {
                value: Gas.DEPLOY_EMPTY_WALLET_VALUE,
                flag: MsgFlag.SENDER_PAYS_FEES
            }(
                Gas.DEPLOY_EMPTY_WALLET_GRAMS,  // deploy_grams
                0,                              // wallet_public_key
                address(this),                  // owner_address
                owner                           // gas_back_address
            );

        IRootTokenContract(tokenRoot)
            .deployEmptyWallet {
                value: Gas.DEPLOY_EMPTY_WALLET_VALUE,
                flag: MsgFlag.SENDER_PAYS_FEES
            }(
                Gas.DEPLOY_EMPTY_WALLET_GRAMS,  // deploy_grams
                0,                              // wallet_public_key
                beneficiary,                    // owner_address
                owner                           // gas_back_address
            );

        IRootTokenContract(tokenRoot)
            .getWalletAddress{
                value: Gas.GET_WALLET_ADDRESS_VALUE,
                flag: MsgFlag.SENDER_PAYS_FEES,
                callback: Vesting.onTokenWallet
            }(
                0,                              // wallet_public_key
                address(this)                   // owner_address
            );

    }

    function onTokenWallet(address wallet) external {
        require(msg.sender.value != 0 && msg.sender == tokenRoot, Errors.NOT_TOKEN_ROOT);
        _reserve();

        tokenWallet = wallet;

        ITONTokenWallet(wallet).setReceiveCallback{
            value: 0,
            flag: MsgFlag.ALL_NOT_RESERVED
        }(address(this), false);
    }

    function _reserve() private view inline {
        tvm.rawReserve(Gas.INITIAL_BALANCE, 0);
    }

}
