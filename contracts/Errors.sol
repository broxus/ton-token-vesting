pragma ton-solidity ^0.39.0;

library Errors {
    uint8 constant NOT_OWNER                 = 101;
    uint8 constant NOT_BENEFICIARY           = 102;
    uint8 constant WRONG_PUBKEY              = 103;
    uint8 constant DEPLOY_VALUE_TOO_LOW      = 104;
    uint8 constant EMPTY_BENEFICIARY         = 105;
    uint8 constant STEP_LONGER_THEN_DURATION = 106;
    uint8 constant TOKEN_ROOT_IS_EMTPY       = 107;
    uint8 constant ZERO_DURATION             = 108;
    uint8 constant START_TIME_IN_PAST        = 109;
    uint8 constant VESTING_IS_NOT_ACTIVE     = 110;
    uint8 constant RELEASE_AMOUNT_IS_ZERO    = 111;
    uint8 constant REVOKE_MSG_VALUE_TOO_LOW  = 112;
    uint8 constant CANT_REVOKE               = 113;
    uint8 constant NOT_TOKEN_WALLET          = 114;
    uint8 constant WRONG_SENDER              = 115;
    uint8 constant NOT_TOKEN_ROOT            = 116;
    uint8 constant RELEASE_MSG_VALUE_TOO_LOW = 117;
    uint8 constant NOT_REVOKED               = 118;
}