pragma ton-solidity >= 0.39.0;

library Gas {
    uint128 constant DEPLOY_VALUE                   = 2 ton;
    uint128 constant REVOKE_MSG_VALUE               = 1 ton;
    uint128 constant RELEASE_MSG_VALUE              = 1 ton;
    uint128 constant INITIAL_BALANCE                = 0.5 ton;
    uint128 constant DEPLOY_EMPTY_WALLET_VALUE      = 0.5 ton;
    uint128 constant DEPLOY_EMPTY_WALLET_GRAMS      = 0.3 ton;
    uint128 constant GET_WALLET_ADDRESS_VALUE       = 0.1 ton;
}
