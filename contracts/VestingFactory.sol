pragma ton-solidity >= 0.39.0;

import "Vesting.sol";
import "Gas.sol";
import "Errors.sol";

import "../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol";
import "../node_modules/@broxus/contracts/contracts/utils/RandomNonce.sol";


contract VestingFactory is RandomNonce {
    uint128 constant FACTORY_DEPLOY_VALUE = 0.5 ton;

    TvmCell vestingCode;

    uint nonce = 0;

    constructor(TvmCell code) public {
        tvm.accept();
        vestingCode = code;
    }

    function deployVesting(
        address tokenRoot,
        address beneficiary,
        uint32 startTime,
        uint32 duration,
        uint32 step,
        bool revocable
    ) public responsible returns (address) {
        require(msg.value >= Gas.DEPLOY_VALUE + FACTORY_DEPLOY_VALUE, Errors.DEPLOY_VALUE_TOO_LOW);

        require(beneficiary.value != 0, Errors.EMPTY_BENEFICIARY);
        require(step <= duration, Errors.STEP_LONGER_THEN_DURATION);
        require(tokenRoot.value != 0, Errors.TOKEN_ROOT_IS_EMTPY);
        require(duration > 0, Errors.ZERO_DURATION);
        require(startTime > now, Errors.START_TIME_IN_PAST);

        tvm.rawReserve(address(this).balance - msg.value, 2);

        TvmCell stateInit = tvm.buildStateInit({
            contr: Vesting,
            varInit: {
                _randomNonce: nonce,
                owner: msg.sender,
                tokenRoot: tokenRoot,
                beneficiary: beneficiary,
                startTime: startTime,
                duration: duration,
                step: step,
                revocable: revocable
            },
            pubkey: 0,
            code: vestingCode
        });
        nonce++;
        address vesting = new Vesting{
            value: Gas.DEPLOY_VALUE,
            flag: MsgFlag.SENDER_PAYS_FEES,
            stateInit: stateInit
        }();
        return {value: 0, flag: MsgFlag.ALL_NOT_RESERVED} vesting;
    }
}
