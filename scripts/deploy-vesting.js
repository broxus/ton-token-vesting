const VESTING_FACTORY_ADDRESS = '';

const VESTING_PARAMS = {
  tokenRoot: '',
  startTime: 0,
  duration: 0,
  step: 0,
  revocable: false
}
const BENEFICIARIES = [
  ''
]
const DEPLOY_VALUE = 2.6

async function main() {
  const [keyPair] = await locklift.keys.getKeyPairs();
  const OutputDecoder = await locklift.factory.getContract('OutputDecoder');

  const Owner = await locklift.factory.getAccount('Wallet');
  let owner = await locklift.giver.deployContract({
    contract: Owner,
    constructorParams: {},
    keyPair: keyPair
  }, locklift.utils.convertCrystal(BENEFICIARIES.length * DEPLOY_VALUE + 5, 'nano'));
  owner.setKeyPair(keyPair);
  console.log(`Owner address: ${owner.address}`);

  const vestingFactory = await locklift.factory.getContract('VestingFactory');
  vestingFactory.setAddress(VESTING_FACTORY_ADDRESS);
  console.log(`VestingFactory address: ${vestingFactory.address}`);

  for (let beneficiary of BENEFICIARIES) {
    const tx = await owner.runTarget({
        contract: vestingFactory,
        method: 'deployVesting',
        value: locklift.utils.convertCrystal(2.6, 'nano'),
        params: {
          tokenRoot: VESTING_PARAMS.tokenRoot,
          beneficiary: beneficiary,
          startTime: VESTING_PARAMS.startTime,
          duration: VESTING_PARAMS.duration,
          step: VESTING_PARAMS.step,
          revocable: VESTING_PARAMS.revocable,
          answerId: 240
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
    const [{value: {addr}}] = await OutputDecoder.decodeMessages(msg, true, undefined);
    const vesting = await locklift.factory.getContract('Vesting');
    vesting.setAddress(addr);
    console.log(`${beneficiary}\t${addr}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
