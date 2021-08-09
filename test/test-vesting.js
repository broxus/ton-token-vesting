const chai = require('chai');
const {expect} = chai;
const BigNumber = require('bignumber.js');
const logger = require('mocha-logger');

const EMPTY_TVM_CELL = 'te6ccgEBAQEAAgAAAA==';

const TOKEN_PATH = './node_modules/ton-eth-bridge-token-contracts/free-ton/build';

const stringToBytesArray = (dataString) => {
    return Buffer.from(dataString).toString('hex')
};

const getRandomNonce = () => Math.random() * 64000 | 0;

const afterRunAmount = 2000;

const afterRun = async (tx) => {
    await new Promise(resolve => setTimeout(resolve, afterRunAmount));
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const VestingStatus = [
    'Initializing',
    'WaitingForTokens',
    'Pending',
    'Active',
    'Released',
    'Revoked'
]

let VestingFactory;
let Vesting;

let factory;
let owner;
let beneficiary;
let token;


const deployTokenRoot = async function (token_name, token_symbol) {
    const RootToken = await locklift.factory.getContract('RootTokenContract', TOKEN_PATH);
    const TokenWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_PATH);
    const [keyPair] = await locklift.keys.getKeyPairs();

    const _root = await locklift.giver.deployContract({
        contract: RootToken,
        constructorParams: {
            root_public_key_: `0x${keyPair.public}`,
            root_owner_address_: locklift.ton.zero_address
        },
        initParams: {
            name: stringToBytesArray(token_name),
            symbol: stringToBytesArray(token_symbol),
            decimals: 9,
            wallet_code: TokenWallet.code,
            _randomNonce: getRandomNonce(),
        },
        keyPair,
    }, locklift.utils.convertCrystal(10, 'nano'));
    _root.afterRun = afterRun;
    _root.setKeyPair(keyPair);

    return _root;
}
const deployTokenWallet = async function (user, amount) {
    const tx = await token.run({
        method: 'deployWallet',
        params: {
            deploy_grams: locklift.utils.convertCrystal(1, 'nano'),
            wallet_public_key_: 0,
            owner_address_: user.address,
            gas_back_address: user.address,
            tokens: amount
        },
    });
    return tx.decoded.output.value0;
}

const deployAccount = async function (key, value) {
    const Account = await locklift.factory.getAccount('Wallet');
    let account = await locklift.giver.deployContract({
        contract: Account,
        constructorParams: {},
        keyPair: key
    }, locklift.utils.convertCrystal(value, 'nano'));
    account.setKeyPair(key);
    account.afterRun = afterRun;
    return account;
}

const now = function () {
    return Math.floor(new Date() / 1000);
}

const deployVesting = async function ({startTime, duration, step, revocable}) {
    const tx = await owner.runTarget({
            contract: factory,
            method: 'deployVesting',
            value: locklift.utils.convertCrystal(2.6, 'nano'),
            params: {
                tokenRoot: token.address,
                beneficiary: beneficiary.address,
                startTime: startTime,
                duration: duration,
                step: step,
                revocable: revocable,
                _answer_id: 240
            }
        }
    )
    const result = await locklift.ton.client.net.query_collection({
        collection: 'messages',
        filter: {
            id: {eq: tx.transaction.out_msgs[0]},
        },
        result: 'dst_transaction { out_messages { id src dst body created_at } }'
    });
    const msg = result.result[0].dst_transaction.out_messages.filter(msg => msg.dst === owner.address);
    const OutputDecoder = await locklift.factory.getContract('OutputDecoder');
    const [{value: {addr}}] = await OutputDecoder.decodeMessages(msg, true, undefined)
    const vesting = await locklift.factory.getContract('Vesting');
    vesting.setAddress(addr)
    return vesting;
}

const depositTokensToVesting = async function (user, depositAmount, vestingAddress) {
    const walletAddress = await token.call({
        method: 'getWalletAddress',
        params: {
            wallet_public_key_: 0,
            owner_address_: user.address
        }
    });
    const tokenWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_PATH);
    tokenWallet.setAddress(walletAddress);
    return await user.runTarget({
        contract: tokenWallet,
        method: 'transferToRecipient',
        params: {
            recipient_public_key: 0,
            recipient_address: vestingAddress,
            tokens: depositAmount,
            deploy_grams: 0,
            transfer_grams: 0,
            send_gas_to: user.address,
            notify_receiver: true,
            payload: EMPTY_TVM_CELL
        },
        value: locklift.utils.convertCrystal(1, 'nano')
    });
};


const getWalletBalance = async function (user) {
    const walletAddress = await token.call({
        method: 'getWalletAddress', params: {
            wallet_public_key_: 0,
            owner_address_: user.address
        }
    });
    const tokenWallet = await locklift.factory.getContract('TONTokenWallet', TOKEN_PATH);
    tokenWallet.setAddress(walletAddress);
    return await tokenWallet.call({method: 'balance'});
}

describe('Vesting', async function () {
    this.timeout(1000000);

    before('Setup Vesting', async function () {
        const keyPairs = await locklift.keys.getKeyPairs();
        logger.log(`Deploying vestingOwner`);
        owner = await deployAccount(keyPairs[0], 10);
        logger.log(owner.address);
        logger.log(`Deploying beneficiary`);
        beneficiary = await deployAccount(keyPairs[1], 10);
        logger.log(beneficiary.address);
        VestingFactory = await locklift.factory.getContract('VestingFactory');
        Vesting = await locklift.factory.getContract('Vesting');
        factory = await locklift.giver.deployContract({
            contract: VestingFactory,
            constructorParams: {
                code: Vesting.code,
            },
            keyPair: keyPairs[0],
        }, locklift.utils.convertCrystal(2, 'nano'));
        logger.log(`VestingFactory address: ${factory.address}`);

        token = await deployTokenRoot('BAR', 'BAR');
        await deployTokenWallet(owner, new BigNumber(222).times(new BigNumber(10).pow(9)));

    })

    describe('Test Vesting Default use case', async function () {
        let vesting;
        let depositAmount = new BigNumber(111).times(new BigNumber(10).pow(9));
        let params = {
            startTime: now() + 30,
            duration: 30 + afterRunAmount / 1000 * 2,
            step: 5,
            revocable: false
        };
        let steps = (params.duration / params.step) >> 0;
        let valuePerStep = depositAmount.dividedToIntegerBy(steps);
        let vestingWalletBalance;
        before('Deploy Vesting', async function () {
            logger.log(`params: ${JSON.stringify(params)}`);
            logger.log(`steps: ${steps}`);
            logger.log(`valuePerStep: ${valuePerStep.toString()}`);
            vesting = await deployVesting(params);
            console.log(vesting.address)
        });
        it('Check vesting status', async function () {
            const status = await vesting.call({method: 'status'});
            expect(VestingStatus[status])
                .to.be.equal('WaitingForTokens', 'Vesting has wrong status');
        });
        it('Check deployed params', async function () {
            const details = await vesting.call({method: 'getDetails'});
            logger.log(`Vesting details: ${JSON.stringify(details)}`);
            expect(details.owner_)
                .to.be.equal(owner.address, 'Wrong owner address');
            expect(details.tokenRoot_)
                .to.be.equal(token.address, 'Wrong token root address');
            expect(details.beneficiary_)
                .to.be.equal(beneficiary.address, 'Wrong beneficiary address');
            expect(details.startTime_.toString())
                .to.be.equal(params.startTime.toString(), 'Wrong startTime param');
            expect(details.duration_.toString())
                .to.be.equal(params.duration.toString(), 'Wrong duration param');
            expect(details.step_.toString())
                .to.be.equal(params.step.toString(), 'Wrong step param');
            expect(details.revocable_)
                .to.be.equal(params.revocable, 'Wrong revocable param');
            expect(details.lastWithdraw_.toString())
                .to.be.equal(params.startTime.toString(), 'Wrong lastWithdraw param');
            expect(details.revoked_)
                .to.be.equal(false, 'Wrong revoked param');
            expect(details.initialBalance_.toString())
                .to.be.equal('0', 'Wrong initialBalance param');
            expect(details.balance_.toString())
                .to.be.equal('0', 'Wrong balance param');
        });
        it('Check vesting wallet balance before', async function () {
            const balance = await getWalletBalance(vesting);
            expect(balance.toString()).to.be.equal('0', 'Wrong balance at start');
            vestingWalletBalance = balance;
        });
        describe('Deposit tokens', async function () {
            let ownerBalance;
            before('Deploy Vesting', async function () {
                ownerBalance = await getWalletBalance(owner);
                logger.log(`Owner balance before: ${ownerBalance.toString()}`);
                logger.log(`Vesting wallet balance before: ${vestingWalletBalance.toString()}`);
                await depositTokensToVesting(owner, depositAmount, vesting.address);
            });
            it('Check vesting wallet after deposit', async function () {
                const balance = await getWalletBalance(vesting);
                expect(balance.toString())
                    .to.be.equal(depositAmount.toString(), 'Wrong balance after deposit');
                vestingWalletBalance = balance;
                logger.log(`Vesting wallet balance after: ${vestingWalletBalance.toString()}`);
            });
            it('Check vesting balance', async function () {
                expect((await vesting.call({method: 'initialBalance'})).toString())
                    .to.be.equal(depositAmount.toString(), 'Wrong initialBalance after deposit');
                expect((await vesting.call({method: 'balance'})).toString())
                    .to.be.equal(depositAmount.toString(), 'Wrong balance after deposit');
            });
            it('Check status after deposit', async function () {
                const status = await vesting.call({method: 'status'});
                expect(VestingStatus[status])
                    .to.be.equal('Pending', 'Vesting has wrong status');
            });
            it('Check releasableAmount after deposit', async function () {
                expect((await vesting.call({method: 'releasableAmount'})).toString())
                    .to.be.equal('0', 'Wrong releasable amount');
            });

        });
        describe('Test release', async function () {
            let beneficiaryBalance;
            before('Wait for vesting start', async function () {
                let timeLeft = params.startTime - now();
                logger.log(`Time left to release start: ${timeLeft}`);
                await wait((timeLeft + params.step + 1) * 1000);
            });
            it('Check status after start time', async function () {
                const status = await vesting.call({method: 'status'});
                expect(VestingStatus[status])
                    .to.be.equal('Active', 'Vesting has wrong status');
            });
            it('Try revoke vesting', async function () {
                await owner.runTarget({
                    contract: vesting,
                    method: 'revoke',
                    value: locklift.utils.convertCrystal(1.1, 'nano')
                })
                const status = await vesting.call({method: 'status'});
                expect(VestingStatus[status])
                    .to.be.equal('Active', 'Vesting has wrong status');
            });
            it('Check release', async function () {
                const expectedRelease = (((now() - params.startTime) / params.step) >> 0) * valuePerStep;
                const expectedReleasePlusOne = new BigNumber(expectedRelease).plus(valuePerStep);
                logger.log(`Expected Release: ${expectedRelease.toString()}`);
                logger.log(`Expected Release +1 step: ${expectedReleasePlusOne.toString()}`);
                expect([expectedRelease.toString(), expectedReleasePlusOne.toString()])
                    .to.be.include((await vesting.call({method: 'releasableAmount'})).toString(), 'Wrong release amount');
                beneficiaryBalance = await getWalletBalance(beneficiary);
                logger.log(`Beneficiary balance Before Release: ${beneficiaryBalance.toString()}`);
                await beneficiary.runTarget({
                    contract: vesting,
                    method: 'release',
                    value: locklift.utils.convertCrystal(1.1, 'nano')
                });
                const tmpBeneficiaryBalance = await getWalletBalance(beneficiary);
                logger.log(`Beneficiary balance after Release: ${tmpBeneficiaryBalance.toString()}`);

                expect([expectedRelease.toString(), expectedReleasePlusOne.toString()])
                    .to.be.include(tmpBeneficiaryBalance.minus(beneficiaryBalance).toString(), 'Wrong beneficiary balance after release');
                expect((await vesting.call({method: 'balance'})).toString())
                    .to.be.equal(depositAmount.minus(tmpBeneficiaryBalance.minus(beneficiaryBalance)).toString(), 'Wrong vesting balance after release');
                beneficiaryBalance = tmpBeneficiaryBalance;
            });
            it('Check full release', async function () {
                let timeLeft = params.startTime + params.duration - now();
                logger.log(`Time left to full release: ${timeLeft}`);
                await wait((timeLeft + 1) * 1000);
                const vestingWalletBalance = await getWalletBalance(vesting);
                logger.log(`Beneficiary balance before full Release: ${beneficiaryBalance.toString()}`);
                logger.log(`Vesting wallet balance before full Release: ${vestingWalletBalance.toString()}`);
                await beneficiary.runTarget({
                    contract: vesting,
                    method: 'release',
                    value: locklift.utils.convertCrystal(1.1, 'nano')
                });
                const tmpBeneficiaryBalance = await getWalletBalance(beneficiary);
                const tmpVestingWalletBalance = await getWalletBalance(vesting);
                beneficiaryBalance = tmpBeneficiaryBalance;
                logger.log(`Beneficiary balance after full Release: ${beneficiaryBalance.toString()}`);
                logger.log(`Vesting wallet balance after full Release: ${tmpVestingWalletBalance.toString()}`);
                expect(tmpBeneficiaryBalance.toString())
                    .to.be.equal(depositAmount.toString(), 'Wrong beneficiary balance after full release');
                expect(tmpBeneficiaryBalance.toString())
                    .to.be.equal(depositAmount.toString(), 'Wrong beneficiary balance after full release');
                expect((await vesting.call({method: 'balance'})).toString())
                    .to.be.equal('0', 'Wrong vesting balance after full release');
                const status = await vesting.call({method: 'status'});
                expect(VestingStatus[status])
                    .to.be.equal('Released', 'Vesting has wrong status after full release');
            });
        });
    });

    describe('Test revoke before start', async function () {
        let vesting;
        let depositAmount = new BigNumber(10).times(new BigNumber(10).pow(9));
        let params = {
            startTime: now() + 999999,
            duration: 1,
            step: 1,
            revocable: false
        };
        before('Deploy Vesting', async function () {
            logger.log(`params: ${JSON.stringify(params)}`);
            vesting = await deployVesting(params);
            console.log(vesting.address);
        });
        it('Check vesting status', async function () {
            const status = await vesting.call({method: 'status'});
            expect(VestingStatus[status])
                .to.be.equal('WaitingForTokens', 'Vesting has wrong status');
        });
        it('Check Revoke', async function () {
            const ownerBalanceBeforeDeposit = await getWalletBalance(owner);
            logger.log(`Owner balance before deposit: ${ownerBalanceBeforeDeposit.toString()}`)
            expect((await vesting.call({method: 'balance'})).toString())
                .to.be.equal('0', 'Wrong vesting balance before deposit');

            await depositTokensToVesting(owner, depositAmount, vesting.address);
            const ownerBalanceAfterDeposit = await getWalletBalance(owner);
            logger.log(`Owner balance after deposit: ${ownerBalanceAfterDeposit.toString()}`);
            expect((await vesting.call({method: 'balance'})).toString())
                .to.be.equal(depositAmount.toString(), 'Wrong vesting balance after deposit');
            let status = await vesting.call({method: 'status'});
            expect(VestingStatus[status])
                .to.be.equal('Pending', 'Vesting has wrong status before revoke');

            await owner.runTarget({
                contract: vesting,
                method: 'revoke',
                value: locklift.utils.convertCrystal(1.1, 'nano')
            });
            const ownerBalanceAfterRevoke = await getWalletBalance(owner);
            logger.log(`Owner balance after revoke: ${ownerBalanceAfterRevoke.toString()}`);
            status = await vesting.call({method: 'status'});
            expect(VestingStatus[status])
                .to.be.equal('Revoked', 'Vesting has wrong status before revoke');
            expect(ownerBalanceAfterRevoke.toString())
                .to.be.equal(ownerBalanceAfterDeposit.plus(depositAmount).toString(), 'wrong owner balance after revoke');
        });
    });
    describe('Test revoke on running vesting', async function () {
        let vesting;
        let depositAmount = new BigNumber(10).times(new BigNumber(10).pow(9));
        let params = {
            startTime: now() + 120,
            duration: 999999,
            step: 2,
            revocable: true
        };
        before('Deploy Vesting', async function () {
            logger.log(`params: ${JSON.stringify(params)}`);
            vesting = await deployVesting(params);
            console.log(vesting.address);
            let timeLeft = params.startTime - now();
            logger.log(`Time left to release start: ${timeLeft}`);
            await wait((timeLeft + 1) * 1000);
        });
        it('Check vesting status', async function () {
            const status = await vesting.call({method: 'status'});
            expect(VestingStatus[status])
                .to.be.equal('WaitingForTokens', 'Vesting has wrong status');
        });
        it('Check Revoke', async function () {
            const ownerBalanceBeforeDeposit = await getWalletBalance(owner);
            logger.log(`Owner balance before deposit: ${ownerBalanceBeforeDeposit.toString()}`)
            expect((await vesting.call({method: 'balance'})).toString())
                .to.be.equal('0', 'Wrong vesting balance before deposit');

            await depositTokensToVesting(owner, depositAmount, vesting.address);
            const ownerBalanceAfterDeposit = await getWalletBalance(owner);
            logger.log(`Owner balance after deposit: ${ownerBalanceAfterDeposit.toString()}`);
            expect((await vesting.call({method: 'balance'})).toString())
                .to.be.equal(depositAmount.toString(), 'Wrong vesting balance after deposit');
            let status = await vesting.call({method: 'status'});
            expect(VestingStatus[status])
                .to.be.equal('Active', 'Vesting has wrong status before revoke');

            await owner.runTarget({
                contract: vesting,
                method: 'revoke',
                value: locklift.utils.convertCrystal(1.1, 'nano')
            });
            const ownerBalanceAfterRevoke = await getWalletBalance(owner);
            logger.log(`Owner balance after revoke: ${ownerBalanceAfterRevoke.toString()}`);
            status = await vesting.call({method: 'status'});
            expect(VestingStatus[status])
                .to.be.equal('Revoked', 'Vesting has wrong status before revoke');
            expect(ownerBalanceAfterRevoke.toString())
                .to.be.equal(ownerBalanceAfterDeposit.plus(depositAmount).toString(), 'wrong owner balance after revoke');
        });
    });

})
