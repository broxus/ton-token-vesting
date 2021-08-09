async function main() {
  const [keyPair] = await locklift.keys.getKeyPairs();

  const VestingFactory = await locklift.factory.getContract('VestingFactory');
  const Vesting = await locklift.factory.getContract('Vesting');

  const vestingFactory = await locklift.giver.deployContract({
    contract: VestingFactory,
    constructorParams: {
      code: Vesting.code,
    },
    initParams:{
      // _randomNonce: 0
    },
    keyPair,
  }, locklift.utils.convertCrystal(2, 'nano'));
  console.log(`VestingFactory address: ${vestingFactory.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
